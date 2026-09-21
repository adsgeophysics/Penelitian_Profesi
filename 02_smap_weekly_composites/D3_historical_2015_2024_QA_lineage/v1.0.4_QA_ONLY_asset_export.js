/*
 * D3-SMAP-HIST-001 | Version 1.0.4 Asset export | 4 August 2026
 * Historical weekly SMAP L4 V8 annual stacks for KHG South Sumatra.
 *
 * Scientific computation:
 *   - Identical to the V103 per-band QA logic that passed manifest review.
 *   - 509 complete weeks, Monday 00:00 WIB to next Monday 00:00 WIB.
 *   - Primary variables: sm_surface_mean and sm_rootzone_mean.
 *   - min/last remain independently masked secondary bands.
 *   - sm_rootzone_pctl remains diagnostic and non-blocking.
 *
 * V104 operational changes:
 *   - Creates 10 annual Image Asset tasks for 2015-2024.
 *   - Does NOT rebuild the expensive 509-row spatial QA manifest.
 *   - Removes weekly.size(), qaManifest.size(), first/last-image evaluation,
 *     and every Map preview that caused interactive memory errors in V103.
 *   - Uses the exact native SMAP projection audited in V103.
 *   - Casts all exported stack bands to Float32 for a uniform Asset schema.
 *   - Creates two lightweight CSV manifests in Google Drive/Penelitian2026.
 *
 * The script only CREATES tasks. Nothing is written until the user starts
 * each task from the Earth Engine Tasks tab.
 */

var CONFIG = {
  aoiAsset: 'projects/ee-adsgeophysics/assets/KHG_SUMSEL',
  sourceCollection: 'NASA/SMAP/SPL4SMGP/008',
  productVersion: 'SPL4SMGP.008',

  // Scientific logic remains V103; V104 is the export-workflow version.
  scienceProcessingVersion: 'D3_SMAP_WEEKLY_1.0.3',
  exportWorkflowVersion: 'D3_SMAP_ASSET_EXPORT_1.0.4',
  parameterSignature: 'SMAP008_WIBMON_56_PERBANDQA_MEANPRIMARY_HARDRANGE01_CATALOG09_PCTLDIAG_COV90_75_OUTAGEFLAG_ANNUALSTACK_FLOAT32_V104',

  driveFolder: 'Penelitian2026',
  assetRoot: 'projects/ee-adsgeophysics/assets',
  assetPrefix: 'D3_SMAP_WEEKLY_STACK',
  exportVersionTag: 'V104',
  createAssetTasks: true,
  createDriveManifestTasks: true,

  startWib: '2015-04-06',
  endExclusiveWib: '2025-01-06',
  expectedWeeks: 509,
  wibOffsetHours: 7,
  expectedImagesPerWeek: 56,
  passCoverage: 0.90,
  warningCoverage: 0.75,
  hardSoilMoistureMin: 0.0,
  hardSoilMoistureMax: 1.0,
  catalogueSoilMoistureMin: 0.0,
  catalogueSoilMoistureMax: 0.9,
  percentileMin: 0.0,
  percentileMax: 100.0,

  // Exact source grid copied from the accepted V103 manifests.
  sourceCrs: 'EPSG:4326',
  sourceCrsTransform: [
    0.09516256938937351, 0, -180.0,
    0, -0.09516149300142858, 85.0445018795655
  ],
  sourceNominalScaleM: 10593.388855,

  maxPixels: 1e10
};

var YEAR_META = [
  {year: 2015, weeks: 39, bands: 663, first: '2015-04-06', last: '2015-12-28'},
  {year: 2016, weeks: 52, bands: 884, first: '2016-01-04', last: '2016-12-26'},
  {year: 2017, weeks: 52, bands: 884, first: '2017-01-02', last: '2017-12-25'},
  {year: 2018, weeks: 53, bands: 901, first: '2018-01-01', last: '2018-12-31'},
  {year: 2019, weeks: 52, bands: 884, first: '2019-01-07', last: '2019-12-30'},
  {year: 2020, weeks: 52, bands: 884, first: '2020-01-06', last: '2020-12-28'},
  {year: 2021, weeks: 52, bands: 884, first: '2021-01-04', last: '2021-12-27'},
  {year: 2022, weeks: 52, bands: 884, first: '2022-01-03', last: '2022-12-26'},
  {year: 2023, weeks: 52, bands: 884, first: '2023-01-02', last: '2023-12-25'},
  {year: 2024, weeks: 53, bands: 901, first: '2024-01-01', last: '2024-12-30'}
];

var SOURCE_BANDS = ['sm_surface', 'sm_rootzone', 'sm_rootzone_pctl'];

var SCIENCE_BANDS = [
  'sm_surface_mean',
  'sm_rootzone_mean',
  'sm_rootzone_pctl_native_mean',
  'sm_surface_min',
  'sm_rootzone_min',
  'sm_surface_last',
  'sm_rootzone_last'
];

var ASSET_QA_BANDS = [
  'sm_surface_valid_count',
  'sm_rootzone_valid_count',
  'sm_rootzone_pctl_valid_count',
  'sm_surface_coverage',
  'sm_rootzone_coverage',
  'sm_rootzone_pctl_coverage',
  'coverage_class',
  'surface_mean_hard_range_ok',
  'rootzone_mean_hard_range_ok',
  'pctl_mean_range_ok'
];

var ASSET_BANDS = SCIENCE_BANDS.concat(ASSET_QA_BANDS);

var OUTAGES = ee.List([
  {start: '2019-06-19T00:00:00Z', end: '2019-07-24T00:00:00Z'},
  {start: '2022-08-06T00:00:00Z', end: '2022-09-21T00:00:00Z'}
]);

var aoiFc = ee.FeatureCollection(CONFIG.aoiAsset);
var aoi = aoiFc.geometry();
var exportRegion = aoi.bounds();
var smap = ee.ImageCollection(CONFIG.sourceCollection).select(SOURCE_BANDS);


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


function bandNativeValidFlag(singleBandImage, outputName) {
  return singleBandImage.mask()
    .unmask(0)
    .rename(outputName)
    .toByte();
}


function bandRangeFlag(singleBandImage, minimum, maximum,
                       nativeValid, outputName) {
  var withinRange = singleBandImage
    .unmask(minimum - 9999)
    .gte(minimum)
    .and(singleBandImage.unmask(maximum + 9999).lte(maximum))
    .unmask(0);

  return nativeValid.and(withinRange)
    .rename(outputName)
    .toByte();
}


function applyIndependentMask(singleBandImage, coverageImage,
                              nativeValid, hardRangeOk) {
  return singleBandImage.updateMask(
    coverageImage.gte(CONFIG.passCoverage)
      .and(nativeValid)
      .and(hardRangeOk)
  );
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
    emptyImage(SOURCE_BANDS)
  ));

  var weeklyMinSource = ee.Image(ee.Algorithms.If(
    hasData,
    subset.select(['sm_surface', 'sm_rootzone']).min(),
    emptyImage(['sm_surface', 'sm_rootzone'])
  ));

  var surfaceMeanRaw = weeklyMeanSource.select('sm_surface')
    .rename('sm_surface_mean');
  var rootzoneMeanRaw = weeklyMeanSource.select('sm_rootzone')
    .rename('sm_rootzone_mean');
  var pctlMeanRaw = weeklyMeanSource.select('sm_rootzone_pctl')
    .rename('sm_rootzone_pctl_native_mean');
  var surfaceMinRaw = weeklyMinSource.select('sm_surface')
    .rename('sm_surface_min');
  var rootzoneMinRaw = weeklyMinSource.select('sm_rootzone')
    .rename('sm_rootzone_min');
  var surfaceLastRaw = lastValidBand(
    subset, 'sm_surface', 'sm_surface_last', hasData
  );
  var rootzoneLastRaw = lastValidBand(
    subset, 'sm_rootzone', 'sm_rootzone_last', hasData
  );

  var validCount = ee.Image(ee.Algorithms.If(
    hasData,
    subset.select(SOURCE_BANDS).count(),
    ee.Image.constant([0, 0, 0]).rename(SOURCE_BANDS)
  )).unmask(0).rename([
    'sm_surface_valid_count',
    'sm_rootzone_valid_count',
    'sm_rootzone_pctl_valid_count'
  ]);

  var coverage = validCount.divide(CONFIG.expectedImagesPerWeek).rename([
    'sm_surface_coverage',
    'sm_rootzone_coverage',
    'sm_rootzone_pctl_coverage'
  ]);

  var surfaceCoverage = coverage.select('sm_surface_coverage');
  var rootzoneCoverage = coverage.select('sm_rootzone_coverage');
  var pctlCoverage = coverage.select('sm_rootzone_pctl_coverage');
  var minimumCoreCoverage = surfaceCoverage.min(rootzoneCoverage);

  var coverageClass = ee.Image(0)
    .where(minimumCoreCoverage.gte(CONFIG.warningCoverage), 1)
    .where(minimumCoreCoverage.gte(CONFIG.passCoverage), 2)
    .rename('coverage_class')
    .toByte();

  // Native validity is evaluated independently for every science band.
  var surfaceMeanNative = bandNativeValidFlag(
    surfaceMeanRaw, 'surface_mean_native_valid'
  );
  var rootzoneMeanNative = bandNativeValidFlag(
    rootzoneMeanRaw, 'rootzone_mean_native_valid'
  );
  var pctlMeanNative = bandNativeValidFlag(
    pctlMeanRaw, 'pctl_mean_native_valid'
  );
  var surfaceMinNative = bandNativeValidFlag(
    surfaceMinRaw, 'surface_min_native_valid'
  );
  var rootzoneMinNative = bandNativeValidFlag(
    rootzoneMinRaw, 'rootzone_min_native_valid'
  );
  var surfaceLastNative = bandNativeValidFlag(
    surfaceLastRaw, 'surface_last_native_valid'
  );
  var rootzoneLastNative = bandNativeValidFlag(
    rootzoneLastRaw, 'rootzone_last_native_valid'
  );

  // Hard range: physically valid volumetric fraction. These flags control masks.
  var surfaceMeanHard = bandRangeFlag(
    surfaceMeanRaw,
    CONFIG.hardSoilMoistureMin,
    CONFIG.hardSoilMoistureMax,
    surfaceMeanNative,
    'surface_mean_hard_range_ok'
  );
  var rootzoneMeanHard = bandRangeFlag(
    rootzoneMeanRaw,
    CONFIG.hardSoilMoistureMin,
    CONFIG.hardSoilMoistureMax,
    rootzoneMeanNative,
    'rootzone_mean_hard_range_ok'
  );
  var surfaceMinHard = bandRangeFlag(
    surfaceMinRaw,
    CONFIG.hardSoilMoistureMin,
    CONFIG.hardSoilMoistureMax,
    surfaceMinNative,
    'surface_min_hard_range_ok'
  );
  var rootzoneMinHard = bandRangeFlag(
    rootzoneMinRaw,
    CONFIG.hardSoilMoistureMin,
    CONFIG.hardSoilMoistureMax,
    rootzoneMinNative,
    'rootzone_min_hard_range_ok'
  );
  var surfaceLastHard = bandRangeFlag(
    surfaceLastRaw,
    CONFIG.hardSoilMoistureMin,
    CONFIG.hardSoilMoistureMax,
    surfaceLastNative,
    'surface_last_hard_range_ok'
  );
  var rootzoneLastHard = bandRangeFlag(
    rootzoneLastRaw,
    CONFIG.hardSoilMoistureMin,
    CONFIG.hardSoilMoistureMax,
    rootzoneLastNative,
    'rootzone_last_hard_range_ok'
  );
  var pctlMeanRange = bandRangeFlag(
    pctlMeanRaw,
    CONFIG.percentileMin,
    CONFIG.percentileMax,
    pctlMeanNative,
    'pctl_mean_range_ok'
  );

  // Catalogue range: non-blocking audit only; never used to mask or HOLD.
  var surfaceMeanCatalogue = bandRangeFlag(
    surfaceMeanRaw,
    CONFIG.catalogueSoilMoistureMin,
    CONFIG.catalogueSoilMoistureMax,
    surfaceMeanNative,
    'surface_mean_catalogue_range_ok'
  );
  var rootzoneMeanCatalogue = bandRangeFlag(
    rootzoneMeanRaw,
    CONFIG.catalogueSoilMoistureMin,
    CONFIG.catalogueSoilMoistureMax,
    rootzoneMeanNative,
    'rootzone_mean_catalogue_range_ok'
  );
  var surfaceMinCatalogue = bandRangeFlag(
    surfaceMinRaw,
    CONFIG.catalogueSoilMoistureMin,
    CONFIG.catalogueSoilMoistureMax,
    surfaceMinNative,
    'surface_min_catalogue_range_ok'
  );
  var rootzoneMinCatalogue = bandRangeFlag(
    rootzoneMinRaw,
    CONFIG.catalogueSoilMoistureMin,
    CONFIG.catalogueSoilMoistureMax,
    rootzoneMinNative,
    'rootzone_min_catalogue_range_ok'
  );
  var surfaceLastCatalogue = bandRangeFlag(
    surfaceLastRaw,
    CONFIG.catalogueSoilMoistureMin,
    CONFIG.catalogueSoilMoistureMax,
    surfaceLastNative,
    'surface_last_catalogue_range_ok'
  );
  var rootzoneLastCatalogue = bandRangeFlag(
    rootzoneLastRaw,
    CONFIG.catalogueSoilMoistureMin,
    CONFIG.catalogueSoilMoistureMax,
    rootzoneLastNative,
    'rootzone_last_catalogue_range_ok'
  );

  // Independent masks: min/last can never invalidate a valid mean.
  var surfaceMeanScience = applyIndependentMask(
    surfaceMeanRaw, surfaceCoverage, surfaceMeanNative, surfaceMeanHard
  );
  var rootzoneMeanScience = applyIndependentMask(
    rootzoneMeanRaw, rootzoneCoverage, rootzoneMeanNative, rootzoneMeanHard
  );
  var surfaceMinScience = applyIndependentMask(
    surfaceMinRaw, surfaceCoverage, surfaceMinNative, surfaceMinHard
  );
  var rootzoneMinScience = applyIndependentMask(
    rootzoneMinRaw, rootzoneCoverage, rootzoneMinNative, rootzoneMinHard
  );
  var surfaceLastScience = applyIndependentMask(
    surfaceLastRaw, surfaceCoverage, surfaceLastNative, surfaceLastHard
  );
  var rootzoneLastScience = applyIndependentMask(
    rootzoneLastRaw, rootzoneCoverage, rootzoneLastNative, rootzoneLastHard
  );
  var pctlMeanScience = applyIndependentMask(
    pctlMeanRaw, pctlCoverage, pctlMeanNative, pctlMeanRange
  );

  var science = surfaceMeanScience
    .addBands(rootzoneMeanScience)
    .addBands(pctlMeanScience)
    .addBands(surfaceMinScience)
    .addBands(rootzoneMinScience)
    .addBands(surfaceLastScience)
    .addBands(rootzoneLastScience)
    .select(SCIENCE_BANDS);

  var qaDetail = validCount
    .addBands(coverage)
    .addBands(coverageClass)
    .addBands(surfaceMeanNative)
    .addBands(rootzoneMeanNative)
    .addBands(pctlMeanNative)
    .addBands(surfaceMinNative)
    .addBands(rootzoneMinNative)
    .addBands(surfaceLastNative)
    .addBands(rootzoneLastNative)
    .addBands(surfaceMeanHard)
    .addBands(rootzoneMeanHard)
    .addBands(surfaceMinHard)
    .addBands(rootzoneMinHard)
    .addBands(surfaceLastHard)
    .addBands(rootzoneLastHard)
    .addBands(pctlMeanRange)
    .addBands(surfaceMeanCatalogue)
    .addBands(rootzoneMeanCatalogue)
    .addBands(surfaceMinCatalogue)
    .addBands(rootzoneMinCatalogue)
    .addBands(surfaceLastCatalogue)
    .addBands(rootzoneLastCatalogue);

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
    .addBands(qaDetail)
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
      processing_version: CONFIG.scienceProcessingVersion,
      parameter_signature: CONFIG.parameterSignature,
      timezone: 'WIB_UTC+7',
      primary_global_gate: 'SURFACE_MEAN_AND_ROOTZONE_MEAN_ONLY',
      min_last_role: 'SECONDARY_INDEPENDENT_BANDS',
      catalogue_range_role: 'NON_BLOCKING_AUDIT',
      pctl_role: 'DIAGNOSTIC_FEATURE_NOT_GLOBAL_GATE',
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


var weekly = makeWeeklyCollection();
var batchFeatures = [];
var targetAssetIds = [];

YEAR_META.forEach(function(meta) {
  var year = meta.year;
  var annual = weekly
    .filter(ee.Filter.eq('week_year', year))
    .sort('system:time_start');

  var assetId = CONFIG.assetRoot + '/' + CONFIG.assetPrefix + '_' + year +
    '_' + CONFIG.exportVersionTag;
  var taskDescription = CONFIG.assetPrefix + '_' + year + '_' +
    CONFIG.exportVersionTag;

  // system:index = WyyyyMMdd, so toBands() produces deterministic names such as
  // W20150406_sm_surface_mean and preserves chronological order.
  var annualStack = annual
    .select(ASSET_BANDS)
    .toBands()
    .toFloat()
    .clip(aoi)
    .set({
      stage_id: 'D3',
      document_id: 'D3-SMAP-HIST-001',
      year: year,
      expected_week_count: meta.weeks,
      expected_band_count: meta.bands,
      first_week_start_wib: meta.first,
      last_week_start_wib: meta.last,
      bands_per_week: ASSET_BANDS.length,
      band_schema: ASSET_BANDS.join('|'),
      band_naming: 'WYYYYMMDD_VARIABLE',
      asset_data_type: 'FLOAT32_ALL_BANDS',
      source_collection: CONFIG.sourceCollection,
      product_version: CONFIG.productVersion,
      science_processing_version: CONFIG.scienceProcessingVersion,
      export_workflow_version: CONFIG.exportWorkflowVersion,
      parameter_signature: CONFIG.parameterSignature,
      timezone: 'WIB_UTC+7',
      storage_layout: 'ANNUAL_MULTIBAND_WEEK_PREFIX',
      primary_global_gate: 'SURFACE_MEAN_AND_ROOTZONE_MEAN_ONLY',
      min_last_role: 'SECONDARY_INDEPENDENT_BANDS',
      catalogue_range_role: 'NON_BLOCKING_AUDIT',
      pctl_role: 'DIAGNOSTIC_FEATURE_NOT_GLOBAL_GATE',
      v103_qa_decision: 'CONDITIONAL_PASS_GO_ASSET_EXPORT'
    });

  if (CONFIG.createAssetTasks) {
    Export.image.toAsset({
      image: annualStack,
      description: taskDescription,
      assetId: assetId,
      region: exportRegion,
      crs: CONFIG.sourceCrs,
      crsTransform: CONFIG.sourceCrsTransform,
      maxPixels: CONFIG.maxPixels,
      pyramidingPolicy: {'.default': 'sample'}
    });
  }

  targetAssetIds.push(assetId);
  batchFeatures.push(ee.Feature(null, {
    batch_year: year,
    asset_id: assetId,
    task_description: taskDescription,
    expected_week_count: meta.weeks,
    asset_bands_per_week: ASSET_BANDS.length,
    expected_band_count: meta.bands,
    first_week_start_wib: meta.first,
    last_week_start_wib: meta.last,
    source_crs: CONFIG.sourceCrs,
    source_nominal_scale_m: CONFIG.sourceNominalScaleM,
    source_transform: CONFIG.sourceCrsTransform.join('|'),
    asset_data_type: 'FLOAT32_ALL_BANDS',
    source_collection: CONFIG.sourceCollection,
    product_version: CONFIG.productVersion,
    science_processing_version: CONFIG.scienceProcessingVersion,
    export_workflow_version: CONFIG.exportWorkflowVersion,
    parameter_signature: CONFIG.parameterSignature,
    storage_layout: 'ANNUAL_MULTIBAND_WEEK_PREFIX',
    primary_global_gate: 'SURFACE_MEAN_AND_ROOTZONE_MEAN_ONLY',
    min_last_role: 'SECONDARY_INDEPENDENT_BANDS',
    catalogue_range_role: 'NON_BLOCKING_AUDIT',
    pctl_role: 'DIAGNOSTIC_FEATURE_NOT_GLOBAL_GATE',
    v103_qa_decision: 'CONDITIONAL_PASS_GO_ASSET_EXPORT',
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
    aoi_asset: CONFIG.aoiAsset,
    source_collection: CONFIG.sourceCollection,
    product_version: CONFIG.productVersion,
    science_processing_version: CONFIG.scienceProcessingVersion,
    export_workflow_version: CONFIG.exportWorkflowVersion,
    parameter_signature: CONFIG.parameterSignature,
    start_wib: CONFIG.startWib,
    end_exclusive_wib: CONFIG.endExclusiveWib,
    expected_week_count: CONFIG.expectedWeeks,
    accepted_v103_week_count: 509,
    accepted_v103_global_pass: 495,
    accepted_v103_pass_with_warning: 14,
    accepted_v103_hold: 0,
    v103_qa_decision: 'CONDITIONAL_PASS_GO_ASSET_EXPORT',
    expected_images_per_week: CONFIG.expectedImagesPerWeek,
    pass_coverage: CONFIG.passCoverage,
    warning_coverage: CONFIG.warningCoverage,
    hard_soil_moisture_range: '0_TO_1_FINITE',
    catalogue_soil_moisture_range: '0_TO_0_9_NON_BLOCKING',
    percentile_range: '0_TO_100',
    source_crs: CONFIG.sourceCrs,
    source_nominal_scale_m: CONFIG.sourceNominalScaleM,
    source_transform: CONFIG.sourceCrsTransform.join('|'),
    output_asset_count: YEAR_META.length,
    asset_bands_per_week: ASSET_BANDS.length,
    expected_total_asset_bands: 8653,
    asset_data_type: 'FLOAT32_ALL_BANDS',
    asset_tasks_created: CONFIG.createAssetTasks,
    drive_manifest_tasks_created: CONFIG.createDriveManifestTasks,
    output_drive_folder: CONFIG.driveFolder,
    output_raster_type: 'INTERMEDIATE_ASSET_ANNUAL_STACK',
    primary_global_gate: 'SURFACE_MEAN_AND_ROOTZONE_MEAN_ONLY',
    min_last_role: 'SECONDARY_INDEPENDENT_BANDS',
    catalogue_range_role: 'NON_BLOCKING_AUDIT',
    pctl_role: 'DIAGNOSTIC_FEATURE_NOT_GLOBAL_GATE',
    interactive_size_checks: 'DISABLED_TO_AVOID_MEMORY_ERROR',
    map_previews: 'DISABLED_TO_AVOID_MEMORY_ERROR',
    timezone: 'WIB_UTC+7',
    generated_on: '2026-08-04'
  })
]);

if (CONFIG.createDriveManifestTasks) {
  Export.table.toDrive({
    collection: batchManifest,
    description: 'D3_SMAP_ASSET_BATCH_MANIFEST_2015_2024_V104',
    folder: CONFIG.driveFolder,
    fileNamePrefix: 'D3_SMAP_ASSET_BATCH_MANIFEST_2015_2024_V104',
    fileFormat: 'CSV'
  });

  Export.table.toDrive({
    collection: runManifest,
    description: 'D3_SMAP_ASSET_RUN_MANIFEST_2015_2024_V104',
    folder: CONFIG.driveFolder,
    fileNamePrefix: 'D3_SMAP_ASSET_RUN_MANIFEST_2015_2024_V104',
    fileFormat: 'CSV'
  });
}

// Client-side-only Console messages: these do not evaluate the 509-image graph.
print('D3 V104 READY: annual Asset export after accepted V103 QA.');
print('Expected Tasks: 10 Image Assets + 2 Drive CSV manifests = 12.');
print('Recommended first validation task:', targetAssetIds[0]);
print('Target Asset IDs:', targetAssetIds);
print('Interactive collection counts and all Map previews are disabled.');