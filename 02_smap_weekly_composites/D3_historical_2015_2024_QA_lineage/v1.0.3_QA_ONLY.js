/*
 * D3-SMAP-HIST-001 | Version 1.0.3 QA-only | 4 August 2026
 * Historical weekly SMAP L4 V8 composites for KHG South Sumatra.
 *
 * Scientific period:
 *   509 complete weeks, Monday 00:00 WIB to next Monday 00:00 WIB
 *   first week_start = 2015-04-06
 *   last  week_start = 2024-12-30
 *
 * V1.0.3 correction after V102 audit:
 *   - Primary global QA is evaluated only from sm_surface_mean and
 *     sm_rootzone_mean, each with its own native mask, coverage, and range.
 *   - mean, min, and last are masked independently. A sparse/invalid min or
 *     last band can no longer invalidate a valid weekly mean.
 *   - The catalogue range 0-0.9 is retained as a non-blocking audit flag.
 *     The hard physical validity gate for surface/root-zone soil moisture is
 *     0-1.0 and finite.
 *   - sm_rootzone_pctl remains diagnostic and never controls global QA.
 *   - Image-count QA and known-outage QA remain separate and traceable.
 *
 * Persistence rule:
 *   - QA-only mode creates only three CSV manifest tasks in Google Drive
 *     folder Penelitian2026.
 *   - Annual Asset tasks remain disabled until all V103 manifests pass review.
 *   - No GeoTIFF is exported at D3 because annual stacks are intermediate
 *     scientific inputs for D4/D5/D9.
 *
 * The script only creates tasks. Nothing is written until the user clicks Run.
 */

var CONFIG = {
  aoiAsset: 'projects/ee-adsgeophysics/assets/KHG_SUMSEL',
  sourceCollection: 'NASA/SMAP/SPL4SMGP/008',
  productVersion: 'SPL4SMGP.008',
  processingVersion: 'D3_SMAP_WEEKLY_1.0.3',
  parameterSignature: 'SMAP008_WIBMON_56_PERBANDQA_MEANPRIMARY_HARDRANGE01_CATALOG09_PCTLDIAG_COV90_75_OUTAGEFLAG_ANNUALSTACK_V103',
  driveFolder: 'Penelitian2026',
  assetRoot: 'projects/ee-adsgeophysics/assets',
  assetPrefix: 'D3_SMAP_WEEKLY_STACK',
  exportVersionTag: 'V103',
  createAssetTasks: false,
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
  reduceScaleM: 11000,
  maxPixels: 1e10,
  tileScale: 4
};

var YEARS = [2015, 2016, 2017, 2018, 2019,
             2020, 2021, 2022, 2023, 2024];

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

// Bands retained in annual Assets after QA approval. Detailed QA flags remain
// available in the manifest but are not duplicated into the annual stacks.
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
var smap = ee.ImageCollection(CONFIG.sourceCollection).select(SOURCE_BANDS);
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
      processing_version: CONFIG.processingVersion,
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


function maskFraction(image, bandName, outputName) {
  return image.select(bandName)
    .mask()
    .unmask(0)
    .rename(outputName)
    .reduceRegion({
      reducer: ee.Reducer.mean(),
      geometry: aoi,
      scale: CONFIG.reduceScaleM,
      maxPixels: CONFIG.maxPixels,
      tileScale: CONFIG.tileScale
    });
}


function buildQaManifest(weeklyCollection) {
  return ee.FeatureCollection(
    weeklyCollection.toList(CONFIG.expectedWeeks).map(function(item) {
      var image = ee.Image(item);

      var stats = image.select([
        'sm_surface_mean',
        'sm_rootzone_mean',
        'sm_rootzone_pctl_native_mean',
        'sm_surface_min',
        'sm_rootzone_min',
        'sm_surface_last',
        'sm_rootzone_last',
        'sm_surface_coverage',
        'sm_rootzone_coverage',
        'sm_rootzone_pctl_coverage'
      ]).reduceRegion({
        reducer: ee.Reducer.mean()
          .combine({reducer2: ee.Reducer.minMax(), sharedInputs: true}),
        geometry: aoi,
        scale: CONFIG.reduceScaleM,
        maxPixels: CONFIG.maxPixels,
        tileScale: CONFIG.tileScale
      });

      var qaFractions = image.select([
        'surface_mean_native_valid',
        'rootzone_mean_native_valid',
        'pctl_mean_native_valid',
        'surface_min_native_valid',
        'rootzone_min_native_valid',
        'surface_last_native_valid',
        'rootzone_last_native_valid',
        'surface_mean_hard_range_ok',
        'rootzone_mean_hard_range_ok',
        'surface_min_hard_range_ok',
        'rootzone_min_hard_range_ok',
        'surface_last_hard_range_ok',
        'rootzone_last_hard_range_ok',
        'pctl_mean_range_ok',
        'surface_mean_catalogue_range_ok',
        'rootzone_mean_catalogue_range_ok',
        'surface_min_catalogue_range_ok',
        'rootzone_min_catalogue_range_ok',
        'surface_last_catalogue_range_ok',
        'rootzone_last_catalogue_range_ok'
      ]).reduceRegion({
        reducer: ee.Reducer.mean(),
        geometry: aoi,
        scale: CONFIG.reduceScaleM,
        maxPixels: CONFIG.maxPixels,
        tileScale: CONFIG.tileScale
      });

      var surfaceMeanScienceFraction = maskFraction(
        image,
        'sm_surface_mean',
        'surface_mean_science_valid_fraction'
      );
      var rootzoneMeanScienceFraction = maskFraction(
        image,
        'sm_rootzone_mean',
        'rootzone_mean_science_valid_fraction'
      );
      var pctlMeanScienceFraction = maskFraction(
        image,
        'sm_rootzone_pctl_native_mean',
        'pctl_mean_science_valid_fraction'
      );
      var surfaceMinScienceFraction = maskFraction(
        image,
        'sm_surface_min',
        'surface_min_science_valid_fraction'
      );
      var rootzoneMinScienceFraction = maskFraction(
        image,
        'sm_rootzone_min',
        'rootzone_min_science_valid_fraction'
      );
      var surfaceLastScienceFraction = maskFraction(
        image,
        'sm_surface_last',
        'surface_last_science_valid_fraction'
      );
      var rootzoneLastScienceFraction = maskFraction(
        image,
        'sm_rootzone_last',
        'rootzone_last_science_valid_fraction'
      );

      var surfaceMeanScience = ee.Number(
        surfaceMeanScienceFraction.get(
          'surface_mean_science_valid_fraction', 0
        )
      );
      var rootzoneMeanScience = ee.Number(
        rootzoneMeanScienceFraction.get(
          'rootzone_mean_science_valid_fraction', 0
        )
      );
      var pctlMeanScience = ee.Number(
        pctlMeanScienceFraction.get(
          'pctl_mean_science_valid_fraction', 0
        )
      );
      var surfaceCoverageMean = ee.Number(
        stats.get('sm_surface_coverage_mean', 0)
      );
      var rootzoneCoverageMean = ee.Number(
        stats.get('sm_rootzone_coverage_mean', 0)
      );
      var pctlCoverageMean = ee.Number(
        stats.get('sm_rootzone_pctl_coverage_mean', 0)
      );

      // The primary spatial gate uses only the two weekly mean variables.
      var primarySpatialQaFraction = surfaceMeanScience
        .min(rootzoneMeanScience)
        .min(surfaceCoverageMean)
        .min(rootzoneCoverageMean);

      var primarySpatialSeverity = ee.Number(ee.Algorithms.If(
        primarySpatialQaFraction.gte(CONFIG.passCoverage),
        0,
        ee.Algorithms.If(
          primarySpatialQaFraction.gte(CONFIG.warningCoverage), 1, 2
        )
      ));

      var imageCountSeverity = ee.Number(
        image.get('image_count_qa_severity')
      );
      var outageSeverity = ee.Number(
        image.get('observation_qa_severity')
      );
      var globalSeverity = primarySpatialSeverity
        .max(imageCountSeverity)
        .max(outageSeverity);

      var finalQc = ee.String(ee.Algorithms.If(
        globalSeverity.eq(0),
        'PASS',
        ee.Algorithms.If(
          globalSeverity.eq(1), 'PASS_WITH_WARNING', 'HOLD'
        )
      ));

      var pctlQaFraction = pctlMeanScience.min(pctlCoverageMean);
      var pctlQc = ee.String(ee.Algorithms.If(
        pctlQaFraction.gte(CONFIG.passCoverage),
        'PASS',
        ee.Algorithms.If(
          pctlQaFraction.gte(CONFIG.warningCoverage),
          'PASS_WITH_WARNING',
          'DIAGNOSTIC_SPARSE'
        )
      ));

      var surfaceCatalogueFraction = ee.Number(
        qaFractions.get('surface_mean_catalogue_range_ok', 0)
      );
      var rootzoneCatalogueFraction = ee.Number(
        qaFractions.get('rootzone_mean_catalogue_range_ok', 0)
      );
      var primaryCatalogueFraction = surfaceCatalogueFraction
        .min(rootzoneCatalogueFraction);
      var catalogueQc = ee.String(ee.Algorithms.If(
        primaryCatalogueFraction.gte(CONFIG.passCoverage),
        'WITHIN_CATALOGUE_RANGE',
        ee.Algorithms.If(
          primaryCatalogueFraction.gte(CONFIG.warningCoverage),
          'CATALOGUE_RANGE_WARNING',
          'CATALOGUE_RANGE_REVIEW'
        )
      ));

      return ee.Feature(null, stats)
        .set(qaFractions)
        .set(surfaceMeanScienceFraction)
        .set(rootzoneMeanScienceFraction)
        .set(pctlMeanScienceFraction)
        .set(surfaceMinScienceFraction)
        .set(rootzoneMinScienceFraction)
        .set(surfaceLastScienceFraction)
        .set(rootzoneLastScienceFraction)
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
          'timezone',
          'primary_global_gate',
          'min_last_role',
          'catalogue_range_role',
          'pctl_role'
        ]))
        .set({
          global_qc_status: finalQc,
          primary_spatial_qc_status: ee.String(ee.Algorithms.If(
            primarySpatialSeverity.eq(0),
            'PASS',
            ee.Algorithms.If(
              primarySpatialSeverity.eq(1),
              'PASS_WITH_WARNING',
              'HOLD'
            )
          )),
          primary_spatial_qa_fraction: primarySpatialQaFraction,
          core_mean_science_valid_fraction: surfaceMeanScience
            .min(rootzoneMeanScience),
          pctl_qc_status: pctlQc,
          pctl_qa_fraction: pctlQaFraction,
          catalogue_range_qc_status: catalogueQc,
          primary_catalogue_range_fraction: primaryCatalogueFraction,
          hard_range_gate: '0_TO_1_FINITE',
          catalogue_range_audit: '0_TO_0_9_NON_BLOCKING',
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

  var annualStack = annual.select(ASSET_BANDS).toBands().set({
    year: year,
    week_count: annual.size(),
    first_week_start_wib: annual.aggregate_min('week_start_wib'),
    last_week_start_wib: annual.aggregate_max('week_start_wib'),
    band_schema: ASSET_BANDS.join('|'),
    source_collection: CONFIG.sourceCollection,
    product_version: CONFIG.productVersion,
    processing_version: CONFIG.processingVersion,
    parameter_signature: CONFIG.parameterSignature,
    timezone: 'WIB_UTC+7',
    storage_layout: 'ANNUAL_MULTIBAND_WEEK_PREFIX',
    primary_global_gate: 'SURFACE_MEAN_AND_ROOTZONE_MEAN_ONLY',
    min_last_role: 'SECONDARY_INDEPENDENT_BANDS',
    catalogue_range_role: 'NON_BLOCKING_AUDIT',
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
    asset_bands_per_week: ASSET_BANDS.length,
    expected_band_count: annual.size().multiply(ASSET_BANDS.length),
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
    primary_global_gate: 'SURFACE_MEAN_AND_ROOTZONE_MEAN_ONLY',
    min_last_role: 'SECONDARY_INDEPENDENT_BANDS',
    catalogue_range_role: 'NON_BLOCKING_AUDIT',
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
    hard_soil_moisture_range: '0_TO_1_FINITE',
    catalogue_soil_moisture_range: '0_TO_0_9_NON_BLOCKING',
    percentile_range: '0_TO_100',
    source_crs: sourceProjection.crs(),
    source_nominal_scale_m: sourceProjection.nominalScale(),
    source_transform: sourceProjection.transform(),
    output_asset_count: YEARS.length,
    asset_bands_per_week: ASSET_BANDS.length,
    asset_tasks_created: CONFIG.createAssetTasks,
    output_drive_folder: CONFIG.driveFolder,
    output_raster_type: 'INTERMEDIATE_ASSET_ANNUAL_STACK',
    primary_global_gate: 'SURFACE_MEAN_AND_ROOTZONE_MEAN_ONLY',
    min_last_role: 'SECONDARY_INDEPENDENT_BANDS',
    catalogue_range_role: 'NON_BLOCKING_AUDIT',
    pctl_role: 'DIAGNOSTIC_FEATURE_NOT_GLOBAL_GATE',
    timezone: 'WIB_UTC+7',
    generated_on: '2026-08-04'
  })
]);


print('D3 V103 source projection', sourceProjection);
print('D3 V103 source projection info', sourceProjectionInfo);
print('D3 V103 weekly count; expected 509', weekly.size());
print('D3 V103 first week', weekly.first());
print('D3 V103 last week', weekly.sort('system:time_start', false).first());
print('D3 V103 QA rows prepared; expected 509', qaManifest.size());
print('D3 V103 Asset tasks enabled?', CONFIG.createAssetTasks);
print('Full QA preview disabled; use the Drive CSV as authoritative output');
print('D3 V103 batch manifest', batchManifest);
print('D3 V103 run manifest', runManifest);

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
  'D3 V103 preview | SMAP surface mean | 2024-07-01'
);
Map.addLayer(
  previewWeek.select('sm_rootzone_mean').clip(aoi),
  {
    min: 0.25,
    max: 0.90,
    palette: ['8C510A', 'DFC27D', 'F6E8C3', '80CDC1', '01665E']
  },
  'D3 V103 preview | SMAP root-zone mean | 2024-07-01',
  false
);
Map.addLayer(
  previewWeek.select('sm_rootzone_pctl_native_mean').clip(aoi),
  {
    min: 0,
    max: 100,
    palette: ['8C510A', 'DFC27D', 'F6E8C3', '80CDC1', '01665E']
  },
  'D3 V103 preview | root-zone percentile | diagnostic',
  false
);
Map.addLayer(
  previewWeek.select('rootzone_mean_catalogue_range_ok').clip(aoi),
  {min: 0, max: 1, palette: ['B91C1C', '16A34A']},
  'D3 V103 preview | root-zone catalogue 0-0.9 audit',
  false
);


Export.table.toDrive({
  collection: qaManifest,
  description: 'D3_SMAP_WEEKLY_QA_MANIFEST_2015_2024_V103',
  folder: CONFIG.driveFolder,
  fileNamePrefix: 'D3_SMAP_WEEKLY_QA_MANIFEST_2015_2024_V103',
  fileFormat: 'CSV'
});

Export.table.toDrive({
  collection: batchManifest,
  description: 'D3_SMAP_BATCH_MANIFEST_2015_2024_V103',
  folder: CONFIG.driveFolder,
  fileNamePrefix: 'D3_SMAP_BATCH_MANIFEST_2015_2024_V103',
  fileFormat: 'CSV'
});

Export.table.toDrive({
  collection: runManifest,
  description: 'D3_SMAP_RUN_MANIFEST_2015_2024_V103',
  folder: CONFIG.driveFolder,
  fileNamePrefix: 'D3_SMAP_RUN_MANIFEST_2015_2024_V103',
  fileFormat: 'CSV'
});