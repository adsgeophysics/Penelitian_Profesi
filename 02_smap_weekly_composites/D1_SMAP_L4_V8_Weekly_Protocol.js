/*
 * D1-SMAP-WEEKLY-001 | Version 1.0 | 4 August 2026
 * Weekly SMAP L4 V8 protocol for KHG South Sumatra.
 *
 * Scientific unit:
 *   Monday 00:00 WIB to next Monday 00:00 WIB
 *   = Sunday 17:00 UTC to next Sunday 17:00 UTC
 *   = 56 expected 3-hourly images per complete week.
 *
 * This script implements the protocol and prepares the one-month D2 test.
 * It does not resample the science product to 1 km.
 */

var CONFIG = {
  aoiAsset: 'projects/ee-adsgeophysics/assets/KHG_SUMSEL',
  sourceCollection: 'NASA/SMAP/SPL4SMGP/008',
  productVersion: 'SPL4SMGP.008',
  processingVersion: 'D1_SMAP_WEEKLY_1.0.0',
  wibOffsetHours: 7,
  expectedImagesPerWeek: 56,
  passCoverage: 0.90,
  warningCoverage: 0.75,
  assetRoot: 'projects/ee-adsgeophysics/assets',
  testStartWib: '2024-07-01',
  testEndExclusiveWib: '2024-08-05'
};

var CORE_BANDS = ['sm_surface', 'sm_rootzone', 'sm_rootzone_pctl'];
var MODEL_ONLY_OUTAGES = ee.List([
  {start: '2019-06-19T00:00:00', end: '2019-07-24T00:00:00'},
  {start: '2022-08-06T00:00:00', end: '2022-09-21T00:00:00'}
]);

var aoiFc = ee.FeatureCollection(CONFIG.aoiAsset);
var aoi = aoiFc.geometry();
var smap = ee.ImageCollection(CONFIG.sourceCollection).select(CORE_BANDS);


function emptyCoreImage() {
  return ee.Image.constant([0, 0, 0])
    .rename(CORE_BANDS)
    .updateMask(ee.Image(0));
}


function weekIntersectsKnownOutage(startUtc, endUtc) {
  var hits = MODEL_ONLY_OUTAGES.map(function(item) {
    item = ee.Dictionary(item);
    var outageStart = ee.Date(item.getString('start'));
    var outageEnd = ee.Date(item.getString('end'));
    var intersects = startUtc.millis().lt(outageEnd.millis())
      .and(endUtc.millis().gt(outageStart.millis()));
    return ee.Number(ee.Algorithms.If(intersects, 1, 0));
  });
  return ee.Number(hits.reduce(ee.Reducer.max())).eq(1);
}


function weeklyComposite(weekStartWibInput) {
  // ee.Date here is a label-clock in WIB. Subtract seven hours for UTC filtering.
  var weekStartWib = ee.Date(weekStartWibInput);
  var weekEndWib = weekStartWib.advance(7, 'day');
  var startUtc = weekStartWib.advance(-CONFIG.wibOffsetHours, 'hour');
  var endUtc = weekEndWib.advance(-CONFIG.wibOffsetHours, 'hour');

  var subset = smap.filterDate(startUtc, endUtc).sort('system:time_start');
  var imageCount = subset.size();
  var hasData = imageCount.gt(0);
  var last = ee.Image(ee.Algorithms.If(
    hasData,
    subset.sort('system:time_start', false).first(),
    emptyCoreImage()
  ));

  var weeklyMeanSource = ee.Image(ee.Algorithms.If(
    hasData,
    subset.mean(),
    emptyCoreImage()
  ));
  var weeklyMinSource = ee.Image(ee.Algorithms.If(
    hasData,
    subset.select(['sm_surface', 'sm_rootzone']).min(),
    ee.Image.constant([0, 0])
      .rename(['sm_surface', 'sm_rootzone'])
      .updateMask(ee.Image(0))
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
  var lastState = last.select(['sm_surface', 'sm_rootzone']).rename([
    'sm_surface_last',
    'sm_rootzone_last'
  ]);

  var validCount = ee.Image(ee.Algorithms.If(
    hasData,
    subset.select(['sm_surface', 'sm_rootzone']).count(),
    ee.Image.constant([0, 0]).rename(['sm_surface', 'sm_rootzone'])
  )).rename([
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
    .rename('coverage_class'); // 2=PASS, 1=WARNING/PARTIAL, 0=HOLD

  var rangeOk = mean.select('sm_surface_mean').gte(0)
    .and(mean.select('sm_surface_mean').lte(0.9))
    .and(mean.select('sm_rootzone_mean').gte(0))
    .and(mean.select('sm_rootzone_mean').lte(0.9))
    .rename('range_ok');

  var scienceMask = minimumCoverage.gte(CONFIG.passCoverage).and(rangeOk);
  var scienceBands = mean
    .addBands(minimum)
    .addBands(lastState)
    .updateMask(scienceMask);

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

  var outageHit = weekIntersectsKnownOutage(startUtc, endUtc);
  var observationMode = ee.String(ee.Algorithms.If(
    outageHit,
    'MODEL_ONLY_OUTAGE_OR_MIXED',
    'ASSIMILATED_EXPECTED'
  ));
  var globalQc = ee.String(ee.Algorithms.If(
    imageCount.eq(CONFIG.expectedImagesPerWeek),
    'PASS',
    ee.Algorithms.If(
      imageCount.gte(Math.ceil(CONFIG.expectedImagesPerWeek * CONFIG.passCoverage)),
      'PASS_WITH_WARNING',
      'HOLD'
    )
  ));

  return scienceBands
    .addBands(validCount)
    .addBands(coverage)
    .addBands(coverageClass)
    .addBands(rangeOk)
    .set({
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
      latest_source_time_utc: latestSourceTime,
      source_collection: CONFIG.sourceCollection,
      product_version: CONFIG.productVersion,
      processing_version: CONFIG.processingVersion,
      timezone: 'WIB_UTC+7',
      'system:time_start': startUtc.millis()
    });
}


function makeWeekStarts(startWib, endExclusiveWib) {
  var start = ee.Date(startWib);
  var end = ee.Date(endExclusiveWib);
  var weekCount = end.difference(start, 'week').floor();
  return ee.List.sequence(0, weekCount.subtract(1)).map(function(index) {
    return start.advance(ee.Number(index), 'week');
  });
}


function makeWeeklyCollection(startWib, endExclusiveWib) {
  return ee.ImageCollection.fromImages(
    makeWeekStarts(startWib, endExclusiveWib).map(weeklyComposite)
  );
}


/*
 * Fixed descriptive climatology, 2015-2024.
 * Use only for descriptive maps. For model training/validation, fit the mean,
 * standard deviation, and empirical CDF inside each training fold in Python.
 */
function addDescriptiveClimatology(image, baselineWeekly) {
  image = ee.Image(image);
  var isoWeek = ee.Number(image.get('iso_week'));
  var neighborWeeks = ee.List.sequence(-2, 2).map(function(offset) {
    return isoWeek.add(ee.Number(offset)).subtract(1).mod(53).add(1);
  });
  var reference = baselineWeekly.filter(ee.Filter.inList('iso_week', neighborWeeks));

  function anomalySet(bandName, prefix) {
    var current = image.select(bandName);
    var refBand = reference.select(bandName);
    var climMean = refBand.mean();
    var climSd = refBand.reduce(ee.Reducer.stdDev());
    var anomalyAbs = current.subtract(climMean).rename(prefix + '_anom_abs');
    var anomalyZ = current.subtract(climMean)
      .divide(climSd)
      .updateMask(climSd.gt(1e-6))
      .rename(prefix + '_anom_z');
    var percentile = refBand.map(function(refImage) {
      return ee.Image(refImage).lte(current);
    }).mean().multiply(100).rename(prefix + '_pctl');
    var dryPercentile = ee.Image(100).subtract(percentile).rename(prefix + '_dry_pctl');
    return anomalyAbs.addBands(anomalyZ).addBands(percentile).addBands(dryPercentile);
  }

  return image
    .addBands(anomalySet('sm_surface_mean', 'sm_surface'))
    .addBands(anomalySet('sm_rootzone_mean', 'sm_rootzone'))
    .set({
      climatology_version: 'SMAP_WEEKLY_FIXED_2015_2024_PM2W_V1',
      climatology_use: 'DESCRIPTIVE_ONLY'
    });
}


// ------------------------------
// D2 one-month test: July 2024
// ------------------------------
var testWeekly = makeWeeklyCollection(
  CONFIG.testStartWib,
  CONFIG.testEndExclusiveWib
);

var testSummary = ee.FeatureCollection(testWeekly.toList(testWeekly.size()).map(function(item) {
  var image = ee.Image(item);
  var statistics = image.select([
    'sm_surface_mean',
    'sm_rootzone_mean',
    'sm_surface_coverage',
    'sm_rootzone_coverage'
  ]).reduceRegion({
    reducer: ee.Reducer.mean()
      .combine({reducer2: ee.Reducer.minMax(), sharedInputs: true}),
    geometry: aoi,
    scale: 11000,
    maxPixels: 1e8,
    bestEffort: true,
    tileScale: 4
  });
  return ee.Feature(null, statistics).set(image.toDictionary([
    'week_start_wib',
    'week_end_wib',
    'filter_start_utc',
    'filter_end_utc',
    'expected_images',
    'actual_images',
    'global_qc_status',
    'smap_observation_mode',
    'known_outage_overlap',
    'latest_source_time_utc',
    'source_collection',
    'product_version',
    'processing_version'
  ]));
}));

print('SMAP source projection', ee.Image(smap.first()).select('sm_surface').projection());
print('D2 test weekly collection', testWeekly);
print('D2 test summary', testSummary);

var representativeWeek = ee.Image(
  testWeekly.filter(ee.Filter.eq('week_start_wib', '2024-07-01')).first()
);

Map.centerObject(aoiFc, 7);
Map.addLayer(
  representativeWeek.select('sm_surface_mean').clip(aoi),
  {min: 0.15, max: 0.55, palette: ['8C510A', 'DFC27D', 'F6E8C3', '80CDC1', '01665E']},
  'SMAP surface mean | week 2024-07-01'
);
Map.addLayer(
  representativeWeek.select('sm_rootzone_mean').clip(aoi),
  {min: 0.20, max: 0.60, palette: ['8C510A', 'DFC27D', 'F6E8C3', '80CDC1', '01665E']},
  'SMAP root-zone mean | week 2024-07-01',
  false
);
Map.addLayer(
  representativeWeek.select('sm_surface_coverage').clip(aoi),
  {min: 0.75, max: 1.0, palette: ['B91C1C', 'F59E0B', '16A34A']},
  'SMAP weekly coverage',
  false
);

// Asset writes occur only after the user manually clicks Run on each task.
Export.table.toAsset({
  collection: testSummary,
  description: 'D2_TEST_SMAP_WEEKLY_SUMMARY_JUL2024',
  assetId: CONFIG.assetRoot + '/D2_TEST_SMAP_WEEKLY_SUMMARY_JUL2024'
});

Export.image.toAsset({
  image: representativeWeek.clip(aoi),
  description: 'D2_TEST_SMAP_WEEK_20240701',
  assetId: CONFIG.assetRoot + '/D2_TEST_SMAP_WEEK_20240701',
  region: aoi,
  scale: 11000,
  maxPixels: 1e10
});

Export.table.toDrive({
  collection: testSummary,
  description: 'D2_TEST_SMAP_WEEKLY_SUMMARY_JUL2024_CSV',
  fileNamePrefix: 'D2_TEST_SMAP_WEEKLY_SUMMARY_JUL2024',
  fileFormat: 'CSV'
});

// Historical collection for D3 (509 complete weeks):
// var weekly2015to2024 = makeWeeklyCollection('2015-04-06', '2025-01-06');
// var descriptive2015to2024 = weekly2015to2024.map(function(img) {
//   return addDescriptiveClimatology(img, weekly2015to2024);
// });