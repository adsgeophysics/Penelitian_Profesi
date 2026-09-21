/*
 * D3-SMAP-HIST-001 | Version 1.0.2 QA-only | 4 August 2026
 * Historical weekly SMAP L4 V8 composites for KHG South Sumatra.
 *
 * Scientific period:
 *   509 complete weeks, Monday 00:00 WIB to next Monday 00:00 WIB
 *   first week_start = 2015-04-06
 *   last  week_start = 2024-12-30
 *
 * V1.0.2 QA correction:
 *   - Core QA is based only on sm_surface and sm_rootzone.
 *   - sm_rootzone_pctl is retained as a diagnostic feature and audited
 *     separately; its native mask cannot invalidate the two core variables.
 *   - Image-count QA and known-outage QA are reported separately.
 *   - Per-group native-valid and range-valid fractions are exported so a low
 *     fraction can be traced to masking versus an out-of-range value.
 *
 * Persistence rule:
 *   - QA-only mode creates only three CSV manifest tasks in the Google Drive
 *     folder Penelitian2026.
 *   - Annual Asset tasks remain disabled until all V102 manifests pass review.
 *   - No GeoTIFF is exported at D3 because annual stacks are intermediate
 *     scientific inputs for D4/D5/D9.
 *
 * The script only creates tasks. Nothing is written until the user clicks Run.
 */

var CONFIG = {
  aoiAsset: 'projects/ee-adsgeophysics/assets/KHG_SUMSEL',
  sourceCollection: 'NASA/SMAP/SPL4SMGP/008',
  productVersion: 'SPL4SMGP.008',
  processingVersion: 'D3_SMAP_WEEKLY_1.0.2',
  parameterSignature: 'SMAP008_WIBMON_56_COREQASEPARATEPCTL_COV90_75_OUTAGEFLAG_ANNUALSTACK_V102',
  driveFolder: 'Penelitian2026',
  assetRoot: 'projects/ee-adsgeophysics/assets',
  assetPrefix: 'D3_SMAP_WEEKLY_STACK',
  exportVersionTag: 'V102',
  createAssetTasks: false,
  startWib: '2015-04-06',
  endExclusiveWib: '2025-01-06',
  expectedWeeks: 509,
  wibOffsetHours: 7,
  expectedImagesPerWeek: 56,
  passCoverage: 0.90,
  warningCoverage: 0.75,
  reduceScaleM: 11000,
  maxPixels: 1e10,
  tileScale: 4
};

var YEARS = [2015, 2016, 2017, 2018, 2019,
             2020, 2021, 2022, 2023, 2024];

var CORE_BANDS = ['sm_surface', 'sm_rootzone', 'sm_rootzone_pctl'];
var SCIENCE_BANDS = [
  'sm_surface_mean',
  'sm_rootzone_mean',
  'sm_rootzone_pctl_native_mean',
  'sm_surface_min',
  'sm_rootzone_min',
  'sm_surface_last',
  'sm_rootzone_last'
];
var QA_BANDS = [
  'sm_surface_valid_count',
  'sm_rootzone_valid_count',
  'sm_surface_coverage',
  'sm_rootzone_coverage',
  'coverage_class',
  'surface_native_valid',
  'rootzone_native_valid',
  'pctl_native_valid',
  'surface_range_ok',
  'rootzone_range_ok',
  'pctl_range_ok',
  'core_range_ok'
];

var OUTAGES = ee.List([
  {start: '2019-06-19T00:00:00Z', end: '2019-07-24T00:00:00Z'},
  {start: '2022-08-06T00:00:00Z', end: '2022-09-21T00:00:00Z'}
]);

var aoiFc = ee.FeatureCollection(CONFIG.aoiAsset);
var aoi = aoiFc.geometry();
var smap = ee.ImageCollection(CONFIG.sourceCollection).select(CORE_BANDS);
var sourceProjection = ee.Image(smap.first()).select('sm_surface').projection();

// One small client-side metadata request preserves the exact source grid in
// every annual Asset export after QA approval.
var sourceProjectionInfo = sourceProjection.getInfo();


function emptyImage(bandNames) {
  return ee.Image.constant(ee.List.repeat(0, bandNames.length))
    .rename(bandNames)
    .updateMask(ee.Image(0));
}


function outageState(startUtc, endUtc) {
  var intersectionFlags = OUTAGES.map(function(item) {
    item = ee.Dictionary(item);
    var outageStart = ee.Date(item.getString('start'));
    var outageEnd = ee.Date(item.getString('end'));
    return ee.Number(startUtc.millis().lt(outageEnd.millis())
      .and(endUtc.millis().gt(outageStart.millis())));
  });

  var fullFlags = OUTAGES.map(function(item) {
    item = ee.Dictionary(item);
    var outageStart = ee.Date(item.getString('start'));
    var outageEnd = ee.Date(item.getString('end'));
    return ee.Number(startUtc.millis().gte(outageStart.millis())
      .and(endUtc.millis().lte(outageEnd.millis())));
  });

  return ee.Dictionary({
    intersects: ee.Number(intersectionFlags.reduce(ee.Reducer.max())),
    full: ee.Number(fullFlags.reduce(ee.Reducer.max()))
  });
}


function lastValidBand(subset, sourceBand, outputBand, hasData) {
  var latestValid = ee.ImageCollection(subset)
    .select(sourceBand)
    .sort('system:time_start')
    .mosaic()
    .rename(outputBand);
  return ee.Image(ee.Algorithms.If(
    hasData,
    latestValid,
    emptyImage([outputBand])
  ));
}


function nativeValidFlag(image, outputName) {
  return image.mask()
    .reduce(ee.Reducer.min())
    .unmask(0)
    .rename(outputName)
    .toByte();
}


function rangeFlag(image, minimum, maximum, nativeValid, outputName) {
  var withinRange = image.unmask(minimum - 9999)
    .gte(minimum)
    .and(image.unmask(maximum + 9999).lte(maximum))
    .reduce(ee.Reducer.min())
    .unmask(0);
  return nativeValid.and(withinRange)
    .rename(outputName)
    .toByte();
}


function weeklyComposite(weekStartWibInput, weekSequenceInput) {
  var weekStartWib = ee.Date(weekStartWibInput);
  var weekEndWib = weekStartWib.advance(7, 'day');
  var startUtc = weekStartWib.advance(-CONFIG.wibOffsetHours, 'hour');
  var endUtc = weekEndWib.advance(-CONFIG.wibOffsetHours, 'hour');
  var weekSequence = ee.Number(weekSequenceInput);
  var weekId = ee.String('W').cat(weekStartWib.format('yyyyMMdd'));

  var subset = smap.filterDate(startUtc, endUtc).sort('system:time_start');
  var imageCount = subset.size();
  var hasData = imageCount.gt(0);

  var weeklyMeanSource = ee.Image(ee.Algorithms.If(
    hasData,
    subset.mean(),
    emptyImage(CORE_BANDS)
  ));
  var weeklyMinSource = ee.Image(ee.Algorithms.If(
    hasData,
    subset.select(['sm_surface', 'sm_rootzone']).min(),
    emptyImage(['sm_surface', 'sm_rootzone'])
  ));

  var mean = weeklyMeanSource.rename([
    'sm_surface_mean',
    'sm_rootzone_mean',
    'sm_rootzone_pctl_native_mean'
  ]);
  var minimum = weeklyMinSource.rename([
    'sm_surface_min',
    'sm_rootzone_min'
  ]);
  var lastState = lastValidBand(
    subset, 'sm_surface', 'sm_surface_last', hasData
  ).addBands(lastValidBand(
    subset, 'sm_rootzone', 'sm_rootzone_last', hasData
  ));

  var validCount = ee.Image(ee.Algorithms.If(
    hasData,
    subset.select(['sm_surface', 'sm_rootzone']).count(),
    ee.Image.constant([0, 0]).rename(['sm_surface', 'sm_rootzone'])
  )).unmask(0).rename([
    'sm_surface_valid_count',
    'sm_rootzone_valid_count'
  ]);
  var coverage = validCount.divide(CONFIG.expectedImagesPerWeek).rename([
    'sm_surface_coverage',
    'sm_rootzone_coverage'
  ]);
  var surfaceCoverage = coverage.select('sm_surface_coverage');
  var rootzoneCoverage = coverage.select('sm_rootzone_coverage');
  var minimumCoverage = coverage.reduce(ee.Reducer.min());
  var coverageClass = ee.Image(0)
    .where(minimumCoverage.gte(CONFIG.warningCoverage), 1)
    .where(minimumCoverage.gte(CONFIG.passCoverage), 2)
    .rename('coverage_class')
    .toByte();

  var scienceRaw = mean.addBands(minimum).addBands(lastState);
  var surfaceRaw = scienceRaw.select([
    'sm_surface_mean',
    'sm_surface_min',
    'sm_surface_last'
  ]);
  var rootzoneRaw = scienceRaw.select([
    'sm_rootzone_mean',
    'sm_rootzone_min',
    'sm_rootzone_last'
  ]);
  var pctlRaw = scienceRaw.select('sm_rootzone_pctl_native_mean');

  var surfaceNativeValid = nativeValidFlag(
    surfaceRaw, 'surface_native_valid'
  );
  var rootzoneNativeValid = nativeValidFlag(
    rootzoneRaw, 'rootzone_native_valid'
  );
  var pctlNativeValid = nativeValidFlag(
    pctlRaw, 'pctl_native_valid'
  );

  var surfaceRangeOk = rangeFlag(
    surfaceRaw, 0, 0.9, surfaceNativeValid, 'surface_range_ok'
  );
  var rootzoneRangeOk = rangeFlag(
    rootzoneRaw, 0, 0.9, rootzoneNativeValid, 'rootzone_range_ok'
  );
  var pctlRangeOk = rangeFlag(
    pctlRaw, 0, 100, pctlNativeValid, 'pctl_range_ok'
  );
  var coreRangeOk = surfaceRangeOk.and(rootzoneRangeOk)
    .rename('core_range_ok')
    .toByte();

  // Core science bands are masked only by their own coverage and ranges.
  // The percentile product keeps its own independent native/range mask.
  var surfaceScience = surfaceRaw.updateMask(
    surfaceCoverage.gte(CONFIG.passCoverage).and(surfaceRangeOk)
  );
  var rootzoneScience = rootzoneRaw.updateMask(
    rootzoneCoverage.gte(CONFIG.passCoverage).and(rootzoneRangeOk)
  );
  var pctlScience = pctlRaw.updateMask(pctlRangeOk);
  var science = surfaceScience
    .addBands(rootzoneScience)
    .addBands(pctlScience)
    .select(SCIENCE_BANDS);

  var latestSourceMillis = ee.Number(ee.Algorithms.If(
    hasData,
    subset.aggregate_max('system:time_start'),
    -9999
  ));
  var latestSourceTime = ee.String(ee.Algorithms.If(
    hasData,
    ee.Date(latestSourceMillis).format("yyyy-MM-dd'T'HH:mm:ss'Z'"),
    'MISSING'
  ));

  var outage = outageState(startUtc, endUtc);
  var outageHit = ee.Number(outage.get('intersects')).eq(1);
  var fullOutage = ee.Number(outage.get('full')).eq(1);
  var observationMode = ee.String(ee.Algorithms.If(
    fullOutage,
    'MODEL_ONLY_OUTAGE',
    ee.Algorithms.If(
      outageHit,
      'MIXED_ASSIMILATION_MODE',
      'ASSIMILATED_EXPECTED'
    )
  ));

  var imageCountSeverity = ee.Number(ee.Algorithms.If(
    imageCount.eq(CONFIG.expectedImagesPerWeek),
    0,
    ee.Algorithms.If(
      imageCount.gte(Math.ceil(
        CONFIG.expectedImagesPerWeek * CONFIG.passCoverage
      )),
      1,
      2
    )
  ));
  var imageCountQc = ee.String(ee.Algorithms.If(
    imageCountSeverity.eq(0),
    'PASS',
    ee.Algorithms.If(
      imageCountSeverity.eq(1), 'PASS_WITH_WARNING', 'HOLD'
    )
  ));
  var observationQc = ee.String(ee.Algorithms.If(
    outageHit, 'PASS_WITH_WARNING', 'PASS'
  ));

  return science
    .addBands(validCount)
    .addBands(coverage)
    .addBands(coverageClass)
    .addBands(surfaceNativeValid)
    .addBands(rootzoneNativeValid)
    .addBands(pctlNativeValid)
    .addBands(surfaceRangeOk)
    .addBands(rootzoneRangeOk)
    .addBands(pctlRangeOk)
    .addBands(coreRangeOk)
    .set({
      week_id: weekId,
      week_sequence: weekSequence,
      week_year: ee.Number.parse(weekStartWib.format('yyyy')),
      week_start_wib: weekStartWib.format('yyyy-MM-dd'),
      week_end_wib: weekEndWib.format('yyyy-MM-dd'),
      filter_start_utc: startUtc.format("yyyy-MM-dd'T'HH:mm:ss'Z'"),
      filter_end_utc: endUtc.format("yyyy-MM-dd'T'HH:mm:ss'Z'"),
      iso_week: ee.Number.parse(weekStartWib.format('w')),
      expected_images: CONFIG.expectedImagesPerWeek,
      actual_images: imageCount,
      image_count_qc_status: imageCountQc,
      image_count_qa_severity: imageCountSeverity,
      observation_qc_status: observationQc,
      observation_qa_severity: ee.Number(ee.Algorithms.If(
        outageHit, 1, 0
      )),
      smap_observation_mode: observationMode,
      known_outage_overlap: outageHit,
      full_outage_week: fullOutage,
      latest_source_time_utc: latestSourceTime,
      source_collection: CONFIG.sourceCollection,
      product_version: CONFIG.productVersion,
      processing_version: CONFIG.processingVersion,
      parameter_signature: CONFIG.parameterSignature,
      timezone: 'WIB_UTC+7',
      'system:index': weekId,
      'system:time_start': startUtc.millis()
    });
}


function makeWeeklyCollection() {
  var indices = ee.List.sequence(0, CONFIG.expectedWeeks - 1);
  var images = indices.map(function(index) {
    index = ee.Number(index);
    var weekStart = ee.Date(CONFIG.startWib).advance(index, 'week');
    return weeklyComposite(weekStart, index.add(1));
  });
  return ee.ImageCollection.fromImages(images).sort('system:time_start');
}


function buildQaManifest(weeklyCollection) {
  return ee.FeatureCollection(
    weeklyCollection.toList(CONFIG.expectedWeeks).map(function(item) {
      var image = ee.Image(item);
      var stats = image.select([
        'sm_surface_mean',
        'sm_rootzone_mean',
        'sm_rootzone_pctl_native_mean',
        'sm_surface_coverage',
        'sm_rootzone_coverage'
      ]).reduceRegion({
        reducer: ee.Reducer.mean()
          .combine({reducer2: ee.Reducer.minMax(), sharedInputs: true}),
        geometry: aoi,
        scale: CONFIG.reduceScaleM,
        maxPixels: CONFIG.maxPixels,
        tileScale: CONFIG.tileScale
      });

      var qaFractions = image.select([
        'surface_native_valid',
        'rootzone_native_valid',
        'pctl_native_valid',
        'surface_range_ok',
        'rootzone_range_ok',
        'pctl_range_ok',
        'core_range_ok'
      ]).reduceRegion({
        reducer: ee.Reducer.mean(),
        geometry: aoi,
        scale: CONFIG.reduceScaleM,
        maxPixels: CONFIG.maxPixels,
        tileScale: CONFIG.tileScale
      });

      var surfaceScienceFraction = image.select('sm_surface_mean')
        .mask().unmask(0).rename('surface_science_valid_fraction')
        .reduceRegion({
          reducer: ee.Reducer.mean(),
          geometry: aoi,
          scale: CONFIG.reduceScaleM,
          maxPixels: CONFIG.maxPixels,
          tileScale: CONFIG.tileScale
        });
      var rootzoneScienceFraction = image.select('sm_rootzone_mean')
        .mask().unmask(0).rename('rootzone_science_valid_fraction')
        .reduceRegion({
          reducer: ee.Reducer.mean(),
          geometry: aoi,
          scale: CONFIG.reduceScaleM,
          maxPixels: CONFIG.maxPixels,
          tileScale: CONFIG.tileScale
        });
      var pctlScienceFraction = image
        .select('sm_rootzone_pctl_native_mean')
        .mask().unmask(0).rename('pctl_science_valid_fraction')
        .reduceRegion({
          reducer: ee.Reducer.mean(),
          geometry: aoi,
          scale: CONFIG.reduceScaleM,
          maxPixels: CONFIG.maxPixels,
          tileScale: CONFIG.tileScale
        });

      var surfaceScience = ee.Number(
        surfaceScienceFraction.get('surface_science_valid_fraction', 0)
      );
      var rootzoneScience = ee.Number(
        rootzoneScienceFraction.get('rootzone_science_valid_fraction', 0)
      );
      var pctlScience = ee.Number(
        pctlScienceFraction.get('pctl_science_valid_fraction', 0)
      );
      var surfaceCoverageMean = ee.Number(
        stats.get('sm_surface_coverage_mean', 0)
      );
      var rootzoneCoverageMean = ee.Number(
        stats.get('sm_rootzone_coverage_mean', 0)
      );
      var spatialQaFraction = surfaceScience
        .min(rootzoneScience)
        .min(surfaceCoverageMean)
        .min(rootzoneCoverageMean);

      var spatialSeverity = ee.Number(ee.Algorithms.If(
        spatialQaFraction.gte(CONFIG.passCoverage),
        0,
        ee.Algorithms.If(
          spatialQaFraction.gte(CONFIG.warningCoverage), 1, 2
        )
      ));
      var imageCountSeverity = ee.Number(
        image.get('image_count_qa_severity')
      );
      var outageSeverity = ee.Number(
        image.get('observation_qa_severity')
      );
      var globalSeverity = spatialSeverity
        .max(imageCountSeverity)
        .max(outageSeverity);
      var finalQc = ee.String(ee.Algorithms.If(
        globalSeverity.eq(0),
        'PASS',
        ee.Algorithms.If(
          globalSeverity.eq(1), 'PASS_WITH_WARNING', 'HOLD'
        )
      ));
      var pctlQc = ee.String(ee.Algorithms.If(
        pctlScience.gte(CONFIG.passCoverage),
        'PASS',
        ee.Algorithms.If(
          pctlScience.gte(CONFIG.warningCoverage),
          'PASS_WITH_WARNING',
          'DIAGNOSTIC_SPARSE'
        )
      ));

      return ee.Feature(null, stats)
        .set(qaFractions)
        .set(surfaceScienceFraction)
        .set(rootzoneScienceFraction)
        .set(pctlScienceFraction)
        .set(image.toDictionary([
          'week_id',
          'week_sequence',
          'week_year',
          'week_start_wib',
          'week_end_wib',
          'filter_start_utc',
          'filter_end_utc',
          'iso_week',
          'expected_images',
          'actual_images',
          'image_count_qc_status',
          'image_count_qa_severity',
          'observation_qc_status',
          'observation_qa_severity',
          'smap_observation_mode',
          'known_outage_overlap',
          'full_outage_week',
          'latest_source_time_utc',
          'source_collection',
          'product_version',
          'processing_version',
          'parameter_signature',
          'timezone'
        ]))
        .set({
          global_qc_status: finalQc,
          spatial_qc_status: ee.String(ee.Algorithms.If(
            spatialSeverity.eq(0),
            'PASS',
            ee.Algorithms.If(
              spatialSeverity.eq(1), 'PASS_WITH_WARNING', 'HOLD'
            )
          )),
          pctl_qc_status: pctlQc,
          spatial_qa_fraction: spatialQaFraction,
          core_science_valid_fraction: surfaceScience.min(rootzoneScience),
          pctl_role: 'DIAGNOSTIC_FEATURE_NOT_GLOBAL_GATE',
          source_crs: sourceProjection.crs(),
          source_nominal_scale_m: sourceProjection.nominalScale(),
          source_transform: sourceProjection.transform()
        });
    })
  );
}


var weekly = makeWeeklyCollection();
var qaManifest = buildQaManifest(weekly);
var batchFeatures = [];

YEARS.forEach(function(year) {
  var annual = weekly
    .filter(ee.Filter.eq('week_year', year))
    .sort('system:time_start');
  var assetId = CONFIG.assetRoot + '/' + CONFIG.assetPrefix + '_' + year +
    '_' + CONFIG.exportVersionTag;
  var annualStack = annual.toBands().set({
    year: year,
    week_count: annual.size(),
    first_week_start_wib: annual.aggregate_min('week_start_wib'),
    last_week_start_wib: annual.aggregate_max('week_start_wib'),
    band_schema: SCIENCE_BANDS.concat(QA_BANDS).join('|'),
    source_collection: CONFIG.sourceCollection,
    product_version: CONFIG.productVersion,
    processing_version: CONFIG.processingVersion,
    parameter_signature: CONFIG.parameterSignature,
    timezone: 'WIB_UTC+7',
    storage_layout: 'ANNUAL_MULTIBAND_WEEK_PREFIX',
    global_qc_gate: 'CORE_SURFACE_ROOTZONE_ONLY',
    pctl_role: 'DIAGNOSTIC_FEATURE_NOT_GLOBAL_GATE'
  });

  if (CONFIG.createAssetTasks) {
    Export.image.toAsset({
      image: annualStack,
      description: CONFIG.assetPrefix + '_' + year + '_' +
        CONFIG.exportVersionTag,
      assetId: assetId,
      region: aoi,
      crs: sourceProjectionInfo.crs,
      crsTransform: sourceProjectionInfo.transform,
      maxPixels: CONFIG.maxPixels,
      pyramidingPolicy: {'.default': 'sample'}
    });
  }

  batchFeatures.push(ee.Feature(null, {
    batch_year: year,
    asset_id: assetId,
    expected_week_count: annual.size(),
    expected_band_count: annual.size().multiply(
      SCIENCE_BANDS.length + QA_BANDS.length
    ),
    first_week_start_wib: annual.aggregate_min('week_start_wib'),
    last_week_start_wib: annual.aggregate_max('week_start_wib'),
    source_crs: sourceProjection.crs(),
    source_nominal_scale_m: sourceProjection.nominalScale(),
    source_transform: sourceProjection.transform(),
    source_collection: CONFIG.sourceCollection,
    product_version: CONFIG.productVersion,
    processing_version: CONFIG.processingVersion,
    parameter_signature: CONFIG.parameterSignature,
    storage_layout: 'ANNUAL_MULTIBAND_WEEK_PREFIX',
    global_qc_gate: 'CORE_SURFACE_ROOTZONE_ONLY',
    pctl_role: 'DIAGNOSTIC_FEATURE_NOT_GLOBAL_GATE',
    required_task_state: 'COMPLETED',
    task_state_verified: 0,
    asset_task_created: CONFIG.createAssetTasks
  }));
});

var batchManifest = ee.FeatureCollection(batchFeatures);
var runManifest = ee.FeatureCollection([
  ee.Feature(null, {
    stage_id: 'D3',
    document_id: 'D3-SMAP-HIST-001',
    source_collection: CONFIG.sourceCollection,
    product_version: CONFIG.productVersion,
    processing_version: CONFIG.processingVersion,
    parameter_signature: CONFIG.parameterSignature,
    aoi_asset: CONFIG.aoiAsset,
    start_wib: CONFIG.startWib,
    end_exclusive_wib: CONFIG.endExclusiveWib,
    expected_week_count: CONFIG.expectedWeeks,
    computed_week_count: weekly.size(),
    expected_images_per_week: CONFIG.expectedImagesPerWeek,
    pass_coverage: CONFIG.passCoverage,
    warning_coverage: CONFIG.warningCoverage,
    source_crs: sourceProjection.crs(),
    source_nominal_scale_m: sourceProjection.nominalScale(),
    source_transform: sourceProjection.transform(),
    output_asset_count: YEARS.length,
    asset_tasks_created: CONFIG.createAssetTasks,
    output_drive_folder: CONFIG.driveFolder,
    output_raster_type: 'INTERMEDIATE_ASSET_ANNUAL_STACK',
    global_qc_gate: 'CORE_SURFACE_ROOTZONE_ONLY',
    pctl_role: 'DIAGNOSTIC_FEATURE_NOT_GLOBAL_GATE',
    timezone: 'WIB_UTC+7',
    generated_on: '2026-08-04'
  })
]);


print('D3 V102 source projection', sourceProjection);
print('D3 V102 source projection info', sourceProjectionInfo);
print('D3 V102 weekly count; expected 509', weekly.size());
print('D3 V102 first week', weekly.first());
print('D3 V102 last week', weekly.sort('system:time_start', false).first());
print('D3 V102 QA rows prepared; expected 509', qaManifest.size());
print('Full QA preview disabled; use the Drive CSV as authoritative output');
print('D3 V102 batch manifest', batchManifest);
print('D3 V102 run manifest', runManifest);

var previewWeek = ee.Image(
  weekly.filter(ee.Filter.eq('week_start_wib', '2024-07-01')).first()
);
Map.centerObject(aoiFc, 7);
Map.addLayer(
  previewWeek.select('sm_surface_mean').clip(aoi),
  {
    min: 0.25,
    max: 0.70,
    palette: ['8C510A', 'DFC27D', 'F6E8C3', '80CDC1', '01665E']
  },
  'D3 V102 preview | SMAP surface mean | 2024-07-01'
);
Map.addLayer(
  previewWeek.select('sm_rootzone_mean').clip(aoi),
  {
    min: 0.25,
    max: 0.90,
    palette: ['8C510A', 'DFC27D', 'F6E8C3', '80CDC1', '01665E']
  },
  'D3 V102 preview | SMAP root-zone mean | 2024-07-01',
  false
);
Map.addLayer(
  previewWeek.select('sm_rootzone_pctl_native_mean').clip(aoi),
  {
    min: 0,
    max: 100,
    palette: ['8C510A', 'DFC27D', 'F6E8C3', '80CDC1', '01665E']
  },
  'D3 V102 preview | root-zone percentile | diagnostic',
  false
);


Export.table.toDrive({
  collection: qaManifest,
  description: 'D3_SMAP_WEEKLY_QA_MANIFEST_2015_2024_V102',
  folder: CONFIG.driveFolder,
  fileNamePrefix: 'D3_SMAP_WEEKLY_QA_MANIFEST_2015_2024_V102',
  fileFormat: 'CSV'
});

Export.table.toDrive({
  collection: batchManifest,
  description: 'D3_SMAP_BATCH_MANIFEST_2015_2024_V102',
  folder: CONFIG.driveFolder,
  fileNamePrefix: 'D3_SMAP_BATCH_MANIFEST_2015_2024_V102',
  fileFormat: 'CSV'
});

Export.table.toDrive({
  collection: runManifest,
  description: 'D3_SMAP_RUN_MANIFEST_2015_2024_V102',
  folder: CONFIG.driveFolder,
  fileNamePrefix: 'D3_SMAP_RUN_MANIFEST_2015_2024_V102',
  fileFormat: 'CSV'
});