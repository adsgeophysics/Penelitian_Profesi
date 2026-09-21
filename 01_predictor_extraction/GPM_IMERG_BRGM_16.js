// =====================================================================
// GPM IMERG V07 DAILY RAINFALL EXTRACTION FOR 16 BRGM STATIONS
// South Sumatra peat hydrology / fire-risk research
//
// Purpose
//   1. Aggregate 30-minute GPM IMERG V07 precipitation to calendar days
//      in Western Indonesia Time (WIB, UTC+7).
//   2. Extract the GPM pixel containing each BRGM station.
//   3. Extract a 10-km buffer mean as a spatial-representativeness check.
//   4. Export the complete 2015-2024 series and the station-period subset.
//
// Dataset
//   NASA/GPM_L3/IMERG_V07, band "precipitation" (mm/hour).
//   One 30-minute rate is converted to depth by multiplying by 0.5 hour.
//
// Prepared: 2026-07-31
// =====================================================================

// ---------------------------- CONFIGURATION ----------------------------

var FULL_START = '2015-01-01';
var FULL_END_EXCLUSIVE = '2025-01-01'; // Includes 2024-12-31.

var TEST_START = '2019-01-01';
var TEST_END_EXCLUSIVE = '2019-01-08'; // Seven WIB calendar days.

var WIB_OFFSET_HOURS = 7;
var HALF_HOUR_TO_HOURS = 0.5;
var EXPECTED_STEPS_PER_DAY = 48;
var GPM_NATIVE_SCALE_M = 11132;
var BUFFER_RADIUS_M = 10000;
var TILE_SCALE = 4;

// Use research-quality final products for the study period.
var ONLY_PERMANENT = true;

// Three tasks will appear in the Tasks tab. Run TEST first.
var CREATE_TEST_EXPORT = true;
var CREATE_FULL_EXPORT = true;
var CREATE_OVERLAP_EXPORT = true;

// Select one destination.
var EXPORT_TARGET = 'DRIVE'; // 'DRIVE' or 'GCS'
var DRIVE_FOLDER = 'Penelitian2026';
var GCS_BUCKET = 'disertasi_2025';
var GCS_PREFIX = 'GPM_IMERG_V07_BRGM_16';

// --------------------------- STATION METADATA ---------------------------

function stationFeature(mapNo, code, name, lon, lat, district, subdistrict,
                        brgmStart, brgmEnd, khgCode, khgName) {
  return ee.Feature(ee.Geometry.Point([lon, lat]), {
    map_no: mapNo,
    station_code: code,
    station_name: name,
    longitude: lon,
    latitude: lat,
    district: district,
    subdistrict: subdistrict,
    brgm_start: brgmStart,
    brgm_end: brgmEnd,
    khg_code: khgCode,
    khg_name: khgName,
    overlay_status: 'Di dalam AOI KHG'
  });
}

var stations = ee.FeatureCollection([
  stationFeature(
    1, 'BRG_160205_02', 'Tanjung Serang',
    104.911705, -3.447086, 'Ogan Komering Ilir', 'Pedamaran',
    '2018-11-28', '2022-03-19', 'KHG.16.02.05',
    'KHG Sungai Burnai - Sungai Sibumbung'
  ),
  stationFeature(
    2, 'SELEH1', 'Seleh 1',
    104.920971, -3.458371, 'Ogan Komering Ilir', 'Pedamaran',
    '2019-01-08', '2022-03-24', 'KHG.16.02.05',
    'KHG Sungai Burnai - Sungai Sibumbung'
  ),
  stationFeature(
    3, 'SELEH2', 'Seleh 2',
    105.143439, -2.676852, 'Banyu Asin', 'Muara Padang',
    '2019-01-12', '2019-12-06', 'KHG.16.02-07.01',
    'KHG Sungai Saleh - Sungai Sugihan'
  ),
  stationFeature(
    5, 'BRG_160214_03', 'Padang Sugihan 3',
    105.232200, -3.019940, 'Ogan Komering Ilir', 'Air Sugihan',
    '2018-11-10', '2023-05-19', 'KHG.16.02-07.01',
    'KHG Sungai Saleh - Sungai Sugihan'
  ),
  stationFeature(
    6, 'BRG_160214_02', 'Padang Sugihan 2',
    105.216600, -3.090585, 'Ogan Komering Ilir', 'Air Sugihan',
    '2018-11-10', '2022-03-08', 'KHG.16.02.01',
    'KHG Sungai Sugihan - Sungai Lumpur'
  ),
  stationFeature(
    7, 'BRG_160214_01', 'Air Sugihan 1',
    105.215600, -3.105565, 'Ogan Komering Ilir', 'Pangkalan Lapam',
    '2018-11-10', '2019-09-18', 'KHG.16.02.01',
    'KHG Sungai Sugihan - Sungai Lumpur'
  ),
  stationFeature(
    8, 'BRG_160609_02', 'Muara Medak 2',
    103.902000, -1.854130, 'Musi Banyuasin', 'Bayung Lencir',
    '2018-11-24', '2019-07-11', 'KHG.15-16.02',
    'KHG Sungai Lalan - Sungai Merang'
  ),
  stationFeature(
    9, 'MUBA2', 'Kepayang',
    104.194887, -2.185613, 'Musi Banyuasin', 'Bayung Lencir',
    '2019-01-08', '2019-05-07', 'KHG.16.06.02',
    'KHG Sei Lalan - Sungai Bentayan'
  ),
  stationFeature(
    10, 'BRG_160609_01', 'Muara Medak 1',
    103.928600, -1.795132, 'Musi Banyuasin', 'Bayung Lencir',
    '2018-11-23', '2022-12-03', 'KHG.15-16.02',
    'KHG Sungai Lalan - Sungai Merang'
  ),
  stationFeature(
    11, 'BRG_160205_01', 'Kedaton',
    104.879161, -3.401407, 'Ogan Komering Ilir', 'Kota Kayu Agung',
    '2018-11-09', '2019-12-14', 'KHG.16.02.05',
    'KHG Sungai Burnai - Sungai Sibumbung'
  ),
  stationFeature(
    12, 'BRG_160611_01', 'Karang Agung',
    104.411300, -2.281653, 'Musi Banyuasin', 'Lalan',
    '2018-11-19', '2023-04-16', 'KHG.16.06-07.03',
    'KHG Sungai Sembilang - Sungai Lalan'
  ),
  stationFeature(
    13, 'BRG_160224_03', 'Cinta Jaya 3',
    104.964700, -3.432265, 'Ogan Komering Ilir', 'Pedamaran',
    '2018-11-10', '2022-12-11', 'KHG.16.02.05',
    'KHG Sungai Burnai - Sungai Sibumbung'
  ),
  stationFeature(
    14, 'BRG_160224_02', 'Cinta Jaya 2',
    104.965100, -3.478628, 'Ogan Komering Ilir', 'Pedamaran',
    '2018-11-10', '2023-06-15', 'KHG.16.02.05',
    'KHG Sungai Burnai - Sungai Sibumbung'
  ),
  stationFeature(
    15, 'BRG_160224_01', 'Cinta Jaya 1',
    104.977500, -3.392495, 'Ogan Komering Ilir', 'Pedamaran',
    '2018-11-10', '2021-07-31', 'KHG.16.02.05',
    'KHG Sungai Burnai - Sungai Sibumbung'
  ),
  stationFeature(
    16, 'BRG_160219_02', 'Air Rumbai',
    105.121000, -3.124240, 'Ogan Komering Ilir', 'Pangkalan Lapam',
    '2018-11-09', '2022-03-23', 'KHG.16.02-07.01',
    'KHG Sungai Saleh - Sungai Sugihan'
  ),
  stationFeature(
    17, 'BRG2', 'Pulai Gading',
    104.061544, -1.761597, 'Musi Banyuasin', 'Bayung Lencir',
    '2019-01-08', '2022-09-20', 'KHG.15-16.02',
    'KHG Sungai Lalan - Sungai Merang'
  )
]);

// ----------------------------- GPM SOURCE -------------------------------

var gpm = ee.ImageCollection('NASA/GPM_L3/IMERG_V07')
  .select('precipitation');

if (ONLY_PERMANENT) {
  gpm = gpm.filter(ee.Filter.eq('status', 'permanent'));
}

// Convert one WIB calendar day to its corresponding UTC interval.
// Example: 2019-01-01 WIB is 2018-12-31 17:00 UTC through
//          2019-01-01 17:00 UTC, using an inclusive-exclusive interval.
function makeDailyWibImage(dateWibInput) {
  var dateWib = ee.Date(dateWibInput);
  var utcStart = dateWib.advance(-WIB_OFFSET_HOURS, 'hour');
  var utcEnd = utcStart.advance(1, 'day');

  var halfHourly = gpm.filterDate(utcStart, utcEnd);
  var rates = halfHourly.select('precipitation');

  var validSteps = rates.count().rename('gpm_valid_steps');
  var dailyRaw = rates
    .map(function(image) {
      return image.multiply(HALF_HOUR_TO_HOURS)
        .copyProperties(image, ['system:time_start']);
    })
    .sum()
    .rename('gpm_daily_mm_raw');

  // A daily QC value exists only when all 48 half-hour intervals are valid.
  var dailyQc = dailyRaw
    .updateMask(validSteps.eq(EXPECTED_STEPS_PER_DAY))
    .rename('gpm_daily_mm_qc');

  var completeness = validSteps
    .divide(EXPECTED_STEPS_PER_DAY)
    .multiply(100)
    .rename('gpm_completeness_pct');

  return dailyRaw
    .addBands(dailyQc)
    .addBands(validSteps.toInt16())
    .addBands(completeness)
    .set({
      'system:time_start': dateWib.millis(),
      date_wib: dateWib.format('yyyy-MM-dd'),
      utc_start: utcStart.format("yyyy-MM-dd'T'HH:mm:ss'Z'"),
      utc_end: utcEnd.format("yyyy-MM-dd'T'HH:mm:ss'Z'")
    });
}

function makeDateList(startDate, endDateExclusive) {
  var start = ee.Date(startDate);
  var end = ee.Date(endDateExclusive);
  var nDays = end.difference(start, 'day');

  return ee.List.sequence(0, nDays.subtract(1)).map(function(dayOffset) {
    return start.advance(ee.Number(dayOffset), 'day');
  });
}

function buildStationDailyRows(startDate, endDateExclusive) {
  var dates = makeDateList(startDate, endDateExclusive);

  var nestedRows = dates.map(function(dateValue) {
    var dateWib = ee.Date(dateValue);
    var dailyImage = makeDailyWibImage(dateWib);
    var utcStart = dateWib.advance(-WIB_OFFSET_HOURS, 'hour');
    var utcEnd = utcStart.advance(1, 'day');

    return stations.map(function(station) {
      station = ee.Feature(station);

      var pointValues = dailyImage.reduceRegion({
        reducer: ee.Reducer.first(),
        geometry: station.geometry(),
        scale: GPM_NATIVE_SCALE_M,
        maxPixels: 1e6,
        tileScale: TILE_SCALE
      });

      var bufferValues = dailyImage.reduceRegion({
        reducer: ee.Reducer.mean(),
        geometry: station.geometry().buffer(BUFFER_RADIUS_M),
        scale: GPM_NATIVE_SCALE_M,
        maxPixels: 1e6,
        tileScale: TILE_SCALE
      });

      var brgmStart = ee.Date(station.get('brgm_start'));
      var brgmEndExclusive = ee.Date(station.get('brgm_end'))
        .advance(1, 'day');
      var withinBrgmPeriod = dateWib.millis().gte(brgmStart.millis())
        .and(dateWib.millis().lt(brgmEndExclusive.millis()));

      var pointSteps = pointValues.get('gpm_valid_steps');
      var pointStatus = ee.String(ee.Algorithms.If(
        ee.Algorithms.IsEqual(pointSteps, null),
        'NO_DATA',
        ee.Algorithms.If(
          ee.Number(pointSteps).eq(EXPECTED_STEPS_PER_DAY),
          'COMPLETE_48',
          'INCOMPLETE_LT_48'
        )
      ));

      return ee.Feature(null, station.toDictionary()).set({
        date_wib: dateWib.format('yyyy-MM-dd'),
        utc_start: utcStart.format("yyyy-MM-dd'T'HH:mm:ss'Z'"),
        utc_end: utcEnd.format("yyyy-MM-dd'T'HH:mm:ss'Z'"),
        within_brgm_period: withinBrgmPeriod,
        gpm_point_mm_raw: pointValues.get('gpm_daily_mm_raw'),
        gpm_point_mm_qc: pointValues.get('gpm_daily_mm_qc'),
        gpm_buffer10km_mm_raw: bufferValues.get('gpm_daily_mm_raw'),
        gpm_buffer10km_mm_qc: bufferValues.get('gpm_daily_mm_qc'),
        gpm_valid_steps_point: pointSteps,
        gpm_completeness_pct_point:
          pointValues.get('gpm_completeness_pct'),
        gpm_qc_status: pointStatus,
        buffer_radius_m: BUFFER_RADIUS_M,
        source_dataset: 'NASA/GPM_L3/IMERG_V07',
        source_band: 'precipitation',
        source_units: 'mm/hour',
        daily_units: 'mm/day',
        timezone: 'WIB (UTC+7)',
        permanent_only: ONLY_PERMANENT
      });
    });
  });

  return ee.FeatureCollection(nestedRows).flatten();
}

// ------------------------- CHECKS AND PREVIEW ---------------------------

Map.centerObject(stations, 7);
Map.addLayer(stations, {color: 'yellow'}, '16 BRGM stations in AOI');

var firstTestUtc = ee.Date(TEST_START).advance(-WIB_OFFSET_HOURS, 'hour');
var testStepCount = gpm
  .filterDate(firstTestUtc, firstTestUtc.advance(1, 'day'))
  .size();

print('Station count; expected 16', stations.size());
print('Half-hour images on first test WIB day; expected 48', testStepCount);
print('GPM collection status filter: permanent only', ONLY_PERMANENT);
print('WIB aggregation example', makeDailyWibImage(TEST_START));

var testRows = buildStationDailyRows(TEST_START, TEST_END_EXCLUSIVE);
print('Test row count; expected 112', testRows.size());
print('First 10 test rows', testRows.limit(10));

var previewChart = ui.Chart.feature.byFeature(
  testRows
    .filter(ee.Filter.eq('station_code', 'BRG_160205_02'))
    .sort('date_wib'),
  'date_wib',
  ['gpm_point_mm_qc']
).setOptions({
  title: 'GPM daily rainfall test - Tanjung Serang',
  hAxis: {title: 'WIB date'},
  vAxis: {title: 'Rainfall (mm/day)'},
  lineWidth: 2,
  pointSize: 4,
  legend: {position: 'none'}
});
print(previewChart);

// ------------------------------- EXPORTS -------------------------------

var outputColumns = [
  'map_no',
  'station_code',
  'station_name',
  'longitude',
  'latitude',
  'district',
  'subdistrict',
  'khg_code',
  'khg_name',
  'date_wib',
  'utc_start',
  'utc_end',
  'brgm_start',
  'brgm_end',
  'within_brgm_period',
  'gpm_point_mm_raw',
  'gpm_point_mm_qc',
  'gpm_buffer10km_mm_raw',
  'gpm_buffer10km_mm_qc',
  'gpm_valid_steps_point',
  'gpm_completeness_pct_point',
  'gpm_qc_status',
  'buffer_radius_m',
  'source_dataset',
  'source_band',
  'source_units',
  'daily_units',
  'timezone',
  'permanent_only'
];

function createTableExport(collection, description, fileNamePrefix) {
  if (EXPORT_TARGET === 'GCS') {
    Export.table.toCloudStorage({
      collection: collection,
      description: description,
      bucket: GCS_BUCKET,
      fileNamePrefix: GCS_PREFIX + '/' + fileNamePrefix,
      fileFormat: 'CSV',
      selectors: outputColumns
    });
  } else {
    Export.table.toDrive({
      collection: collection,
      description: description,
      folder: DRIVE_FOLDER,
      fileNamePrefix: fileNamePrefix,
      fileFormat: 'CSV',
      selectors: outputColumns
    });
  }
}

if (CREATE_TEST_EXPORT) {
  createTableExport(
    testRows,
    'TEST_GPM_IMERG_V07_BRGM_16_WIB_7D',
    'TEST_GPM_IMERG_V07_BRGM_16_WIB_20190101_20190107'
  );
}

if (CREATE_FULL_EXPORT || CREATE_OVERLAP_EXPORT) {
  var fullRows = buildStationDailyRows(FULL_START, FULL_END_EXCLUSIVE);

  if (CREATE_FULL_EXPORT) {
    createTableExport(
      fullRows,
      'GPM_IMERG_V07_BRGM_16_WIB_2015_2024',
      'GPM_IMERG_V07_BRGM_16_WIB_2015_2024'
    );
  }

  if (CREATE_OVERLAP_EXPORT) {
    var overlapRows = fullRows.filter(
      ee.Filter.eq('within_brgm_period', true)
    );

    createTableExport(
      overlapRows,
      'GPM_IMERG_V07_BRGM_16_WIB_OVERLAP',
      'GPM_IMERG_V07_BRGM_16_WIB_OVERLAP_2018_2023'
    );
  }
}

// Expected output sizes:
//   TEST:        7 days x 16 stations = 112 rows.
//   FULL:     3653 days x 16 stations = 58,448 rows.
//   OVERLAP: station-specific BRGM calendar periods = 16,472 rows.
