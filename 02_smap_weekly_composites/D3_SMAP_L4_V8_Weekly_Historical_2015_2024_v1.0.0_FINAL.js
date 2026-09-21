/*
 * D3-SMAP-HIST-001 | Version 1.0.0 | 4 August 2026
 * Historical weekly SMAP L4 V8 composites for KHG South Sumatra.
 *
 * Scientific period:
 *   509 complete weeks, Monday 00:00 WIB to next Monday 00:00 WIB
 *   first week_start = 2015-04-06
 *   last  week_start = 2024-12-30
 *
 * Persistence rule:
 *   - Ten annual multiband raster stacks are exported to Earth Engine Assets
 *     because D4/D5/D9 will load them again.
 *   - QA, batch, and run manifests are exported as CSV to Google Drive folder
 *     Penelitian2026 for audit and download.
 *   - No GeoTIFF is exported at D3 because these rasters are intermediate
 *     scientific inputs, not final map products.
 *
 * The script only creates tasks. Nothing is written until the user clicks Run.
 */

var CONFIG = {
  aoiAsset: 'projects/ee-adsgeophysics/assets/KHG_SUMSEL',
  sourceCollection: 'NASA/SMAP/SPL4SMGP/008',
  productVersion: 'SPL4SMGP.008',
  processingVersion: 'D3_SMAP_WEEKLY_1.0.0',
  parameterSignature: 'SMAP008_WIBMON_56_COV90_75_OUTAGEFLAG_ANNUALSTACK_V100',
  driveFolder: 'Penelitian2026',
  assetRoot: 'projects/ee-adsgeophysics/assets',
  assetPrefix: 'D3_SMAP_WEEKLY_STACK',
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
  'range_ok'
];

var OUTAGES = ee.List([
  {start: '2019-06-19T00:00:00Z', end: '2019-07-24T00:00:00Z'},
  {start: '2022-08-06T00:00:00Z', end: '2022-09-21T00:00:00Z'}
]);

var aoiFc = ee.FeatureCollection(CONFIG.aoiAsset);
var aoi = aoiFc.geometry();
var smap = ee.ImageCollection(CONFIG.sourceCollection).select(CORE_BANDS);
var sourceProjection = ee.Image(smap.first()).select('sm_surface').projection();

// A single small client-side metadata request preserves the exact source grid
// in every Asset export. Do not replace crsTransform with scale alone.
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
  var minimumCoverage = coverage.reduce(ee.Reducer.min());
  var coverageClass = ee.Image(0)
    .where(minimumCoverage.gte(CONFIG.warningCoverage), 1)
    .where(minimumCoverage.gte(CONFIG.passCoverage), 2)
    .rename('coverage_class');

  var scienceRaw = mean.addBands(minimum).addBands(lastState);
  var rangeOk = scienceRaw.gte(0)
    .and(scienceRaw.lte(0.9))
    .reduce(ee.Reducer.min())
    .rename('range_ok');
  var scienceMask = minimumCoverage.gte(CONFIG.passCoverage).and(rangeOk);
  var science = scienceRaw.updateMask(scienceMask);

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

  var globalQc = ee.String(ee.Algorithms.If(
    imageCount.eq(CONFIG.expectedImagesPerWeek),
    ee.Algorithms.If(outageHit, 'PASS_WITH_WARNING', 'PASS'),
    ee.Algorithms.If(
      imageCount.gte(Math.ceil(CONFIG.expectedImagesPerWeek * CONFIG.passCoverage)),
      'PASS_WITH_WARNING',
      'HOLD'
    )
  ));

  return science
    .addBands(validCount)
    .addBands(coverage)
    .addBands(coverageClass)
    .addBands(rangeOk)
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
      global_qc_status: globalQc,
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
  return ee.FeatureCollection(weeklyCollection.toList(CONFIG.expectedWeeks).map(function(item) {
    var image = ee.Image(item);
    var stats = image.select([
      'sm_surface_mean',
      'sm_rootzone_mean',
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

    var scienceValidFraction = image.select('sm_surface_mean')
      .mask().unmask(0).rename('science_valid_fraction')
      .reduceRegion({
        reducer: ee.Reducer.mean(),
        geometry: aoi,
        scale: CONFIG.reduceScaleM,
        maxPixels: CONFIG.maxPixels,
        tileScale: CONFIG.tileScale
      });
    var rangeOkFraction = image.select('range_ok')
      .unmask(0).rename('range_ok_fraction')
      .reduceRegion({
        reducer: ee.Reducer.mean(),
        geometry: aoi,
        scale: CONFIG.reduceScaleM,
        maxPixels: CONFIG.maxPixels,
        tileScale: CONFIG.tileScale
      });

    return ee.Feature(null, stats)
      .set(scienceValidFraction)
      .set(rangeOkFraction)
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
        'global_qc_status',
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
        source_crs: sourceProjection.crs(),
        source_nominal_scale_m: sourceProjection.nominalScale(),
        source_transform: sourceProjection.transform()
      });
  }));
}


var weekly = makeWeeklyCollection();
var qaManifest = buildQaManifest(weekly);
var batchFeatures = [];

YEARS.forEach(function(year) {
  var annual = weekly
    .filter(ee.Filter.eq('week_year', year))
    .sort('system:time_start');
  var assetId = CONFIG.assetRoot + '/' + CONFIG.assetPrefix + '_' + year + '_V100';
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
    storage_layout: 'ANNUAL_MULTIBAND_WEEK_PREFIX'
  });

  Export.image.toAsset({
    image: annualStack,
    description: CONFIG.assetPrefix + '_' + year + '_V100',
    assetId: assetId,
    region: aoi,
    crs: sourceProjectionInfo.crs,
    crsTransform: sourceProjectionInfo.transform,
    maxPixels: CONFIG.maxPixels,
    pyramidingPolicy: {'.default': 'sample'}
  });

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
    expected_task_state: 'COMPLETED'
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
    output_drive_folder: CONFIG.driveFolder,
    output_raster_type: 'INTERMEDIATE_ASSET_ANNUAL_STACK',
    timezone: 'WIB_UTC+7',
    generated_on: '2026-08-04'
  })
]);


print('D3 source projection', sourceProjection);
print('D3 source projection info', sourceProjectionInfo);
print('D3 weekly collection; expected 509', weekly);
print('D3 weekly count; expected 509', weekly.size());
print('D3 first week', weekly.first());
print('D3 last week', weekly.sort('system:time_start', false).first());
print('D3 QA manifest', qaManifest.limit(10));
print('D3 batch manifest', batchManifest);
print('D3 run manifest', runManifest);

var previewWeek = ee.Image(
  weekly.filter(ee.Filter.eq('week_start_wib', '2024-07-01')).first()
);
Map.centerObject(aoiFc, 7);
Map.addLayer(
  previewWeek.select('sm_surface_mean').clip(aoi),
  {min: 0.25, max: 0.70, palette: ['8C510A', 'DFC27D', 'F6E8C3', '80CDC1', '01665E']},
  'D3 preview | SMAP surface mean | 2024-07-01'
);
Map.addLayer(
  previewWeek.select('sm_rootzone_mean').clip(aoi),
  {min: 0.25, max: 0.90, palette: ['8C510A', 'DFC27D', 'F6E8C3', '80CDC1', '01665E']},
  'D3 preview | SMAP root-zone mean | 2024-07-01',
  false
);
Map.addLayer(
  previewWeek.select('sm_surface_coverage').clip(aoi),
  {min: 0.75, max: 1.0, palette: ['B91C1C', 'F59E0B', '16A34A']},
  'D3 preview | coverage',
  false
);


Export.table.toDrive({
  collection: qaManifest,
  description: 'D3_SMAP_WEEKLY_QA_MANIFEST_2015_2024_V100',
  folder: CONFIG.driveFolder,
  fileNamePrefix: 'D3_SMAP_WEEKLY_QA_MANIFEST_2015_2024_V100',
  fileFormat: 'CSV'
});

Export.table.toDrive({
  collection: batchManifest,
  description: 'D3_SMAP_BATCH_MANIFEST_2015_2024_V100',
  folder: CONFIG.driveFolder,
  fileNamePrefix: 'D3_SMAP_BATCH_MANIFEST_2015_2024_V100',
  fileFormat: 'CSV'
});

Export.table.toDrive({
  collection: runManifest,
  description: 'D3_SMAP_RUN_MANIFEST_2015_2024_V100',
  folder: CONFIG.driveFolder,
  fileNamePrefix: 'D3_SMAP_RUN_MANIFEST_2015_2024_V100',
  fileFormat: 'CSV'
});