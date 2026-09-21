// ============================================================================
// GPM IMERG V07 -> KALIBRASI GPM-BRGM DUA TAHAP -> FITUR HUJAN 1-30 HARI
// Penelitian risiko kebakaran gambut Sumatera Selatan
//
// Grain output : satu baris per stasiun per hari WIB
// Periode      : 2015-01-01 s.d. 2024-12-31
// Asset        : KHG_SUMSEL dan STASIUN_BRGM_16
// Tujuan Drive : folder Penelitian2026
//
// Model final (31 Juli 2026):
//   Tahap 1 = regresi logistik untuk kejadian hujan >= 1 mm/hari.
//   Tahap 2 = regresi Huber pada ln(1 + hujan) untuk intensitas positif.
//   Prediktor = rata-rata GPM pada buffer 10 km + musim bulanan harmonik.
//
// CATATAN PENTING
//   1. IMERG 30-menit diagregasi ke hari kalender WIB terlebih dahulu.
//   2. Laju mm/jam dikalikan 0,5 jam lalu dijumlahkan sebanyak 48 interval.
//   3. Setiap ekspor tahunan mengambil 29 hari sebelumnya sebagai warm-up.
//      Karena itu, akumulasi 30 hari pada 1 Januari tetap lengkap.
//   4. Model diterapkan ke seluruh 16 stasiun. Properti
//      station_in_calibration_set menunjukkan 9 stasiun yang membentuk model.
//   5. Jalankan TEST terlebih dahulu. Aktifkan ekspor tahunan hanya setelah
//      TEST selesai dan lolos pemeriksaan.
// ============================================================================

// ----------------------------- KONFIGURASI ---------------------------------

var AOI_ASSET = 'projects/ee-adsgeophysics/assets/KHG_SUMSEL';
var STATION_ASSET =
  'projects/ee-adsgeophysics/assets/STASIUN_BRGM_16';

var DRIVE_FOLDER = 'Penelitian2026';
var DATASET_ID = 'NASA/GPM_L3/IMERG_V07';
var SOURCE_BAND = 'precipitation';

var WIB_OFFSET_HOURS = 7;
var HALF_HOUR_TO_HOURS = 0.5;
var EXPECTED_STEPS_PER_DAY = 48;
var GPM_NATIVE_SCALE_M = 11132;
var BUFFER_RADIUS_M = 10000;
var TILE_SCALE = 4;
var DAY_MS = 24 * 60 * 60 * 1000;
var MAX_WINDOW_DAYS = 30;

// Produk final/permanent digunakan untuk konsistensi penelitian.
var ONLY_PERMANENT = true;

// Mode aman: uji 7 hari lebih dahulu.
var CREATE_TEST_EXPORT = false;
var CREATE_ANNUAL_EXPORTS = true;

var TEST_START = '2019-01-01';
var TEST_END_EXCLUSIVE = '2019-01-08';
var YEARS = [2015, 2016, 2017, 2018, 2019,
             2020, 2021, 2022, 2023, 2024];

// -------------------------- PARAMETER MODEL FINAL ---------------------------

var WET_THRESHOLD_MM_DAY = 1.0;
var OCCURRENCE_PROBABILITY_THRESHOLD = 0.45;

var OCCURRENCE = {
  intercept: -1.9989917082970008,
  logGpm: 1.2123245713292512,
  monthSin: 0.29400577301819264,
  monthCos: 0.053979584981986566
};

var INTENSITY = {
  intercept: 1.2011518444120506,
  logGpm: 0.3650578012586378,
  monthSin: 0.04591849203325665,
  monthCos: -0.005627429916749691
};

var CALIBRATION_STATION_CODES = ee.List([
  'BRG_160205_01',
  'BRG_160205_02',
  'BRG_160214_02',
  'BRG_160219_02',
  'BRG_160224_02',
  'BRG_160224_03',
  'BRG_160609_01',
  'BRG_160609_02',
  'BRG_160611_01'
]);

// ----------------------------- INPUT ASSET ---------------------------------

var aoi = ee.FeatureCollection(AOI_ASSET);
var stations = ee.FeatureCollection(STATION_ASSET);

var gpm = ee.ImageCollection(DATASET_ID).select(SOURCE_BAND);
if (ONLY_PERMANENT) {
  gpm = gpm.filter(ee.Filter.eq('status', 'permanent'));
}

// ------------------------ AGREGASI HARIAN WIB -------------------------------

function makeDateList(startDate, endDateExclusive) {
  var start = ee.Date(startDate);
  var end = ee.Date(endDateExclusive);
  var nDays = end.difference(start, 'day');

  return ee.List.sequence(0, nDays.subtract(1)).map(function(offset) {
    return start.advance(ee.Number(offset), 'day');
  });
}

function makeDailyWibImage(dateWibInput) {
  var dateWib = ee.Date(dateWibInput);
  var utcStart = dateWib.advance(-WIB_OFFSET_HOURS, 'hour');
  var utcEnd = utcStart.advance(1, 'day');
  var halfHourly = gpm.filterDate(utcStart, utcEnd);

  var validSteps = halfHourly.count().rename('gpm_valid_steps');
  var dailyRaw = halfHourly.map(function(image) {
    return image.multiply(HALF_HOUR_TO_HOURS)
      .copyProperties(image, ['system:time_start']);
  }).sum().rename('gpm_daily_mm_raw');

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

function buildRawStationRows(startDate, endDateExclusive) {
  var dates = makeDateList(startDate, endDateExclusive);

  var nestedRows = dates.map(function(dateValue) {
    var dateWib = ee.Date(dateValue);
    var dailyImage = makeDailyWibImage(dateWib);
    var utcStart = dateWib.advance(-WIB_OFFSET_HOURS, 'hour');
    var utcEnd = utcStart.advance(1, 'day');

    return stations.map(function(stationInput) {
      var station = ee.Feature(stationInput);

      var pointValues = dailyImage.reduceRegion({
        reducer: ee.Reducer.first(),
        geometry: station.geometry(),
        scale: GPM_NATIVE_SCALE_M,
        maxPixels: 1e6,
        tileScale: TILE_SCALE
      });

      // Reducer mean pada geometri buffer 10 km dibuat sama dengan tahap
      // kalibrasi sebelumnya, sehingga koefisien diterapkan pada prediktor
      // yang definisinya identik.
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
        'system:time_start': dateWib.millis(),
        date_wib: dateWib.format('yyyy-MM-dd'),
        utc_start: utcStart.format("yyyy-MM-dd'T'HH:mm:ss'Z'"),
        utc_end: utcEnd.format("yyyy-MM-dd'T'HH:mm:ss'Z'"),
        within_brgm_period: ee.Number(ee.Algorithms.If(
          withinBrgmPeriod, 1, 0
        )),
        station_in_calibration_set: ee.Number(ee.Algorithms.If(
          CALIBRATION_STATION_CODES.contains(station.get('station_code')),
          1,
          0
        )),
        gpm_point_mm_raw: pointValues.get('gpm_daily_mm_raw'),
        gpm_point_mm_qc: pointValues.get('gpm_daily_mm_qc'),
        gpm_buffer10km_mm_raw: bufferValues.get('gpm_daily_mm_raw'),
        gpm_buffer10km_mm_qc: bufferValues.get('gpm_daily_mm_qc'),
        gpm_valid_steps_point: pointSteps,
        gpm_completeness_pct_point:
          pointValues.get('gpm_completeness_pct'),
        gpm_qc_status: pointStatus,
        buffer_radius_m: BUFFER_RADIUS_M,
        source_dataset: DATASET_ID,
        source_band: SOURCE_BAND,
        source_units: 'mm/hour',
        daily_units: 'mm/day',
        timezone: 'WIB (UTC+7)',
        permanent_only: ONLY_PERMANENT
      });
    });
  });

  return ee.FeatureCollection(nestedRows).flatten();
}

// -------------------------- MODEL DUA TAHAP --------------------------------

function calibrateStationRow(featureInput) {
  var feature = ee.Feature(featureInput);
  var gpmObject = feature.get('gpm_buffer10km_mm_qc');
  var stepsObject = feature.get('gpm_valid_steps_point');

  var hasGpm = ee.Number(ee.Algorithms.If(
    ee.Algorithms.IsEqual(gpmObject, null), 0, 1
  ));
  var hasSteps = ee.Number(ee.Algorithms.If(
    ee.Algorithms.IsEqual(stepsObject, null), 0, 1
  ));

  // Nilai aman hanya dipakai di cabang komputasi. Output tetap null apabila
  // data tidak lengkap.
  var gpmSafe = ee.Number(ee.Algorithms.If(hasGpm.eq(1), gpmObject, 0))
    .max(0);
  var stepsSafe = ee.Number(ee.Algorithms.If(
    hasSteps.eq(1), stepsObject, 0
  ));
  var validDay = hasGpm.eq(1)
    .and(hasSteps.eq(1))
    .and(stepsSafe.eq(EXPECTED_STEPS_PER_DAY));

  var dateWib = ee.Date(feature.get('system:time_start'));
  var month = ee.Number(dateWib.get('month'));
  var angle = month.multiply(2 * Math.PI / 12);
  var monthSin = angle.sin();
  var monthCos = angle.cos();
  var logGpm = gpmSafe.add(1).log();

  var logit = logGpm.multiply(OCCURRENCE.logGpm)
    .add(monthSin.multiply(OCCURRENCE.monthSin))
    .add(monthCos.multiply(OCCURRENCE.monthCos))
    .add(OCCURRENCE.intercept);

  var wetProbability = ee.Number(1).divide(
    ee.Number(1).add(logit.multiply(-1).exp())
  );
  var wetFlagBoolean = wetProbability.gte(
    OCCURRENCE_PROBABILITY_THRESHOLD
  );
  var wetFlag = ee.Number(ee.Algorithms.If(wetFlagBoolean, 1, 0));

  var logPositiveRain = logGpm.multiply(INTENSITY.logGpm)
    .add(monthSin.multiply(INTENSITY.monthSin))
    .add(monthCos.multiply(INTENSITY.monthCos))
    .add(INTENSITY.intercept);
  var positiveRain = logPositiveRain.exp()
    .subtract(1)
    .max(WET_THRESHOLD_MM_DAY);
  var correctedRain = ee.Number(ee.Algorithms.If(
    wetFlagBoolean,
    positiveRain,
    0
  ));

  return feature.set({
    model_name: 'LOGISTIC_HUBER_LOG',
    model_version: '2026-07-31',
    model_predictor: 'gpm_buffer10km_mm_qc',
    wet_threshold_mm_day: WET_THRESHOLD_MM_DAY,
    occurrence_probability_threshold:
      OCCURRENCE_PROBABILITY_THRESHOLD,
    month_sin: monthSin,
    month_cos: monthCos,
    log_gpm_buffer10km: ee.Algorithms.If(validDay, logGpm, null),
    wet_probability_calibrated: ee.Algorithms.If(
      validDay, wetProbability, null
    ),
    wet_flag_calibrated: ee.Algorithms.If(validDay, wetFlag, null),
    gpm_calibrated_mm_day: ee.Algorithms.If(
      validDay, correctedRain, null
    ),
    calibration_qc_status: ee.Algorithms.If(
      validDay,
      'CALIBRATED_COMPLETE_48',
      'NOT_CALIBRATED_MISSING_OR_INCOMPLETE'
    )
  });
}

// ----------------------- FITUR AKUMULASI HUJAN ------------------------------

function addAccumulationFeatures(targetRows, allRowsWithWarmup) {
  var sameStation = ee.Filter.equals({
    leftField: 'station_code',
    rightField: 'station_code'
  });

  var withinPrevious29Days = ee.Filter.maxDifference({
    difference: (MAX_WINDOW_DAYS - 1) * DAY_MS,
    leftField: 'system:time_start',
    rightField: 'system:time_start'
  });

  var historyNotAfterTarget = ee.Filter.greaterThanOrEquals({
    leftField: 'system:time_start',
    rightField: 'system:time_start'
  });

  var joinCondition = ee.Filter.and(
    sameStation,
    withinPrevious29Days,
    historyNotAfterTarget
  );

  var saveHistory = ee.Join.saveAll({
    matchesKey: 'history_30d',
    ordering: 'system:time_start',
    ascending: true,
    outer: true
  });

  var joined = ee.FeatureCollection(saveHistory.apply(
    targetRows,
    allRowsWithWarmup,
    joinCondition
  ));

  return joined.map(function(featureInput) {
    var feature = ee.Feature(featureInput);
    var targetDate = ee.Date(feature.get('system:time_start'));
    var history = ee.FeatureCollection(ee.List(feature.get('history_30d')));

    function summarizeWindow(days) {
      var start = targetDate.advance(-(days - 1), 'day');
      var endExclusive = targetDate.advance(1, 'day');
      var windowRows = history.filterDate(start, endExclusive);
      var validRows = windowRows.filter(
        ee.Filter.notNull(['gpm_calibrated_mm_day'])
      );
      var validCount = validRows.size();
      var complete = validCount.eq(days);

      return ee.Dictionary({
        valid_count: validCount,
        complete: ee.Number(ee.Algorithms.If(complete, 1, 0)),
        sum_mm: ee.Algorithms.If(
          complete,
          validRows.aggregate_sum('gpm_calibrated_mm_day'),
          null
        )
      });
    }

    var w1 = summarizeWindow(1);
    var w3 = summarizeWindow(3);
    var w7 = summarizeWindow(7);
    var w14 = summarizeWindow(14);
    var w30 = summarizeWindow(30);

    // Hilangkan daftar join yang besar sebelum ekspor; hanya properti akhir
    // yang dipertahankan.
    var cleanProperties = feature.propertyNames().remove('history_30d');
    var output = ee.Feature(null, feature.toDictionary(cleanProperties));

    return output.set({
      gpm_calibrated_accum_1d_mm: w1.get('sum_mm'),
      gpm_calibrated_accum_3d_mm: w3.get('sum_mm'),
      gpm_calibrated_accum_7d_mm: w7.get('sum_mm'),
      gpm_calibrated_accum_14d_mm: w14.get('sum_mm'),
      gpm_calibrated_accum_30d_mm: w30.get('sum_mm'),
      valid_days_1d: w1.get('valid_count'),
      valid_days_3d: w3.get('valid_count'),
      valid_days_7d: w7.get('valid_count'),
      valid_days_14d: w14.get('valid_count'),
      valid_days_30d: w30.get('valid_count'),
      complete_window_1d: w1.get('complete'),
      complete_window_3d: w3.get('complete'),
      complete_window_7d: w7.get('complete'),
      complete_window_14d: w14.get('complete'),
      complete_window_30d: w30.get('complete'),
      accumulation_definition:
        'current_WIB_day_plus_preceding_days_inclusive'
    });
  });
}

function buildCalibratedFeatureTable(startDate, endDateExclusive) {
  var warmupStart = ee.Date(startDate)
    .advance(-(MAX_WINDOW_DAYS - 1), 'day');

  var allRows = buildRawStationRows(warmupStart, endDateExclusive)
    .map(calibrateStationRow);
  var targetRows = allRows.filterDate(startDate, endDateExclusive);

  return addAccumulationFeatures(targetRows, allRows)
    .sort('system:time_start');
}

// ----------------------------- PEMERIKSAAN ---------------------------------

Map.centerObject(aoi, 7);
Map.addLayer(
  aoi.style({color: '00FFFF', fillColor: '00000000', width: 1}),
  {},
  'KHG_SUMSEL'
);
Map.addLayer(stations, {color: 'yellow'}, 'STASIUN_BRGM_16');

print('AOI asset', AOI_ASSET);
print('Station asset', STATION_ASSET);
print('Station count; expected 16', stations.size());
print('Calibration-station count; expected 9',
      stations.filter(ee.Filter.inList(
        'station_code', CALIBRATION_STATION_CODES
      )).size());
print('Model', 'LOGISTIC + HUBER_LOG; buffer 10 km; WIB');

var outputColumns = [
  'map_no',
  'station_no',
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
  'station_in_calibration_set',
  'gpm_point_mm_raw',
  'gpm_point_mm_qc',
  'gpm_buffer10km_mm_raw',
  'gpm_buffer10km_mm_qc',
  'gpm_valid_steps_point',
  'gpm_completeness_pct_point',
  'gpm_qc_status',
  'wet_probability_calibrated',
  'wet_flag_calibrated',
  'gpm_calibrated_mm_day',
  'gpm_calibrated_accum_1d_mm',
  'gpm_calibrated_accum_3d_mm',
  'gpm_calibrated_accum_7d_mm',
  'gpm_calibrated_accum_14d_mm',
  'gpm_calibrated_accum_30d_mm',
  'valid_days_1d',
  'valid_days_3d',
  'valid_days_7d',
  'valid_days_14d',
  'valid_days_30d',
  'complete_window_1d',
  'complete_window_3d',
  'complete_window_7d',
  'complete_window_14d',
  'complete_window_30d',
  'calibration_qc_status',
  'model_name',
  'model_version',
  'model_predictor',
  'wet_threshold_mm_day',
  'occurrence_probability_threshold',
  'buffer_radius_m',
  'source_dataset',
  'source_band',
  'source_units',
  'daily_units',
  'timezone',
  'permanent_only',
  'accumulation_definition'
];

function createDriveExport(collection, description, fileNamePrefix) {
  Export.table.toDrive({
    collection: collection,
    description: description,
    folder: DRIVE_FOLDER,
    fileNamePrefix: fileNamePrefix,
    fileFormat: 'CSV',
    selectors: outputColumns
  });
}

// ------------------------------- EKSPOR ------------------------------------

if (CREATE_TEST_EXPORT) {
  var testFeatures = buildCalibratedFeatureTable(
    TEST_START,
    TEST_END_EXCLUSIVE
  );

  print('TEST row count; expected 112', testFeatures.size());
  print('TEST station count; expected 16',
        testFeatures.aggregate_count_distinct('station_code'));
  print('TEST minimum valid days in 30-day window; expected 30',
        testFeatures.aggregate_min('valid_days_30d'));
  print('TEST incomplete 30-day windows; expected 0',
        testFeatures.filter(
          ee.Filter.eq('complete_window_30d', 0)
        ).size());
  print('TEST first 10 rows', testFeatures.limit(10));

  var testChart = ui.Chart.feature.byFeature(
    testFeatures
      .filter(ee.Filter.eq('station_code', 'BRG_160205_02'))
      .sort('date_wib'),
    'date_wib',
    ['gpm_buffer10km_mm_qc', 'gpm_calibrated_mm_day']
  ).setOptions({
    title: 'Uji GPM mentah vs terkalibrasi - Tanjung Serang',
    hAxis: {title: 'Tanggal WIB'},
    vAxis: {title: 'Curah hujan (mm/hari)'},
    lineWidth: 2,
    pointSize: 3
  });
  print(testChart);

  createDriveExport(
    testFeatures,
    'TEST_GPM_CAL_FEATURES_BRGM16_20190101_20190107',
    'TEST_GPM_CAL_FEATURES_BRGM16_20190101_20190107'
  );
}

if (CREATE_ANNUAL_EXPORTS) {
  YEARS.forEach(function(year) {
    var start = year + '-01-01';
    var end = (year + 1) + '-01-01';
    var expectedDays = (year === 2016 || year === 2020 || year === 2024)
      ? 366
      : 365;
    var expectedRows = expectedDays * 16;
    var annualFeatures = buildCalibratedFeatureTable(start, end);

    print(
      'Annual rows ' + year + '; expected ' + expectedRows,
      annualFeatures.size()
    );
    print(
      'Incomplete 30-day windows ' + year + '; expected 0',
      annualFeatures.filter(
        ee.Filter.eq('complete_window_30d', 0)
      ).size()
    );

    createDriveExport(
      annualFeatures,
      'GPM_CAL_FEATURES_BRGM16_' + year,
      'GPM_CAL_FEATURES_BRGM16_' + year
    );
  });
}

// Total target output after all annual CSV files are combined:
//   3,653 days x 16 stations = 58,448 rows.
// Leap years in the period: 2016, 2020, and 2024.