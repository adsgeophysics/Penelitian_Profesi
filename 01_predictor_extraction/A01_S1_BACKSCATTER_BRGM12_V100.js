/*
 * A-01 — Sentinel-1 Backscatter Extraction for Field-Calibrated Peat Moisture
 * Version: V100
 * Date: 20 August 2026
 *
 * INPUT LOGIC
 * -----------
 * Uses the 12 retained stations after MATCH-01:
 *   - 8 PRIMARY_CORE: main LOSO modelling
 *   - 4 SUPPORTING: sensitivity/robustness only
 *
 * Excluded from primary extraction:
 *   BRG2, SELEH1, SELEH2, MUBA2
 *
 * SENTINEL-1
 * ----------
 * COPERNICUS/S1_GRD
 * IW, 10 m, VV + VH
 *
 * SPATIAL SUPPORT
 * ---------------
 * Primary: 30 m radius median
 * Sensitivity: 50 m radius median
 *
 * Also exports mean, standard deviation, valid-pixel count and incidence angle.
 * No speckle filter is imposed here; spatial robust statistics are retained
 * so the modelling stage can compare support choices under LOSO.
 *
 * IMPORTANT
 * ---------
 * This script does NOT fit the SM model.
 * It exports backscatter predictors only.
 */

var CONFIG = {
  sourceCollection: 'COPERNICUS/S1_GRD',
  globalStart: '2019-01-01',
  globalEndExclusive: '2023-06-16',
  timezone: 'Asia/Jakarta',
  wibOffsetHours: 7,
  driveFolder: 'Penelitian2026',
  version: 'A01_S1_BACKSCATTER_V100',
  scaleMeters: 10,
  bufferPrimaryM: 30,
  bufferSensitivityM: 50
};

// station_code, station_name, lon, lat, field_start, field_end, role
var stationRows = [
  ['BRG_160205_02', 'Tanjung Serang',   104.911705, -3.447086, '2018-11-28', '2022-03-19', 'PRIMARY_CORE'],
  ['BRG_160214_02', 'Padang Sugihan 2', 105.216600, -3.090585, '2018-11-10', '2022-03-08', 'PRIMARY_CORE'],
  ['BRG_160214_03', 'Padang Sugihan 3', 105.232200, -3.019940, '2018-11-10', '2023-05-19', 'PRIMARY_CORE'],
  ['BRG_160224_01', 'Cinta Jaya 1',     104.977500, -3.392495, '2018-11-10', '2021-07-31', 'PRIMARY_CORE'],
  ['BRG_160224_02', 'Cinta Jaya 2',     104.965100, -3.478628, '2018-11-10', '2023-06-15', 'PRIMARY_CORE'],
  ['BRG_160224_03', 'Cinta Jaya 3',     104.964700, -3.432265, '2018-11-10', '2022-12-11', 'PRIMARY_CORE'],
  ['BRG_160609_01', 'Muara Medak 1',    103.928600, -1.795132, '2018-11-23', '2022-12-03', 'PRIMARY_CORE'],
  ['BRG_160611_01', 'Karang Agung',     104.411300, -2.281653, '2018-11-19', '2023-04-16', 'PRIMARY_CORE'],

  ['BRG_160205_01', 'Kedaton',          104.879161, -3.401407, '2018-11-09', '2019-12-14', 'SUPPORTING'],
  ['BRG_160214_01', 'Air Sugihan 1',    105.215600, -3.105565, '2018-11-10', '2019-09-18', 'SUPPORTING'],
  ['BRG_160219_02', 'Air Rumbai',       105.121000, -3.124240, '2018-11-09', '2022-03-23', 'SUPPORTING'],
  ['BRG_160609_02', 'Muara Medak 2',    103.902000, -1.854130, '2018-11-24', '2019-07-11', 'SUPPORTING']
];

var stations = ee.FeatureCollection(stationRows.map(function(r) {
  return ee.Feature(
    ee.Geometry.Point([r[2], r[3]]),
    {
      station_code: r[0],
      station_name: r[1],
      longitude: r[2],
      latitude: r[3],
      field_start: r[4],
      field_end: r[5],
      station_role: r[6]
    }
  );
}));

var s1 = ee.ImageCollection(CONFIG.sourceCollection)
  .filterDate(CONFIG.globalStart, CONFIG.globalEndExclusive)
  .filter(ee.Filter.eq('instrumentMode', 'IW'))
  .filter(ee.Filter.eq('resolution_meters', CONFIG.scaleMeters))
  .filter(ee.Filter.listContains('transmitterReceiverPolarisation', 'VV'))
  .filter(ee.Filter.listContains('transmitterReceiverPolarisation', 'VH'));

var reducer = ee.Reducer.median()
  .combine({reducer2: ee.Reducer.mean(), sharedInputs: true})
  .combine({reducer2: ee.Reducer.stdDev(), sharedInputs: true})
  .combine({reducer2: ee.Reducer.count(), sharedInputs: true});

function safeGet(d, key) {
  return ee.Dictionary(d).get(key);
}

function extractSceneFeature(st, img) {
  st = ee.Feature(st);
  img = ee.Image(img);

  var tUtc = ee.Date(img.get('system:time_start'));
  var tWib = tUtc.advance(CONFIG.wibOffsetHours, 'hour');

  var geom30 = st.geometry().buffer(CONFIG.bufferPrimaryM);
  var geom50 = st.geometry().buffer(CONFIG.bufferSensitivityM);

  var bands = img.select(['VV', 'VH', 'angle']);

  var r30 = bands.reduceRegion({
    reducer: reducer,
    geometry: geom30,
    scale: CONFIG.scaleMeters,
    maxPixels: 10000,
    tileScale: 2
  });

  var r50 = bands.reduceRegion({
    reducer: reducer,
    geometry: geom50,
    scale: CONFIG.scaleMeters,
    maxPixels: 20000,
    tileScale: 2
  });

  return ee.Feature(null, {
    station_code: st.get('station_code'),
    station_name: st.get('station_name'),
    station_role: st.get('station_role'),
    longitude: st.get('longitude'),
    latitude: st.get('latitude'),
    field_start: st.get('field_start'),
    field_end: st.get('field_end'),

    image_id: img.id(),
    system_index: img.get('system:index'),
    acquisition_utc: tUtc.format('YYYY-MM-dd HH:mm:ss', 'UTC'),
    acquisition_wib: tWib.format('YYYY-MM-dd HH:mm:ss', CONFIG.timezone),
    acquisition_date_wib: tWib.format('YYYY-MM-dd', CONFIG.timezone),
    year_wib: ee.Number.parse(tWib.format('YYYY', CONFIG.timezone)),

    platform_number: img.get('platform_number'),
    orbit_pass: img.get('orbitProperties_pass'),
    relative_orbit_start: img.get('relativeOrbitNumber_start'),
    absolute_orbit_start: img.get('orbitNumber_start'),

    // 30 m primary support
    vv_median_30m_db: safeGet(r30, 'VV_median'),
    vh_median_30m_db: safeGet(r30, 'VH_median'),
    angle_median_30m_deg: safeGet(r30, 'angle_median'),
    vv_mean_30m_db: safeGet(r30, 'VV_mean'),
    vh_mean_30m_db: safeGet(r30, 'VH_mean'),
    angle_mean_30m_deg: safeGet(r30, 'angle_mean'),
    vv_stddev_30m_db: safeGet(r30, 'VV_stdDev'),
    vh_stddev_30m_db: safeGet(r30, 'VH_stdDev'),
    vv_count_30m: safeGet(r30, 'VV_count'),
    vh_count_30m: safeGet(r30, 'VH_count'),

    // 50 m sensitivity support
    vv_median_50m_db: safeGet(r50, 'VV_median'),
    vh_median_50m_db: safeGet(r50, 'VH_median'),
    angle_median_50m_deg: safeGet(r50, 'angle_median'),
    vv_mean_50m_db: safeGet(r50, 'VV_mean'),
    vh_mean_50m_db: safeGet(r50, 'VH_mean'),
    angle_mean_50m_deg: safeGet(r50, 'angle_mean'),
    vv_stddev_50m_db: safeGet(r50, 'VV_stdDev'),
    vh_stddev_50m_db: safeGet(r50, 'VH_stdDev'),
    vv_count_50m: safeGet(r50, 'VV_count'),
    vh_count_50m: safeGet(r50, 'VH_count'),

    audit_version: CONFIG.version
  });
}

// Build one flat list of Features.
// End date is advanced by one day because filterDate uses an exclusive end.
var nested = stations.toList(stations.size()).map(function(stObj) {
  var st = ee.Feature(stObj);

  var start = ee.Date(st.get('field_start'));
  var endExclusive = ee.Date(st.get('field_end')).advance(1, 'day');

  // Enforce project-wide 2019 lower bound.
  start = ee.Date(ee.Algorithms.If(
    start.millis().lt(ee.Date(CONFIG.globalStart).millis()),
    ee.Date(CONFIG.globalStart),
    start
  ));

  // Enforce global end bound.
  endExclusive = ee.Date(ee.Algorithms.If(
    endExclusive.millis().gt(ee.Date(CONFIG.globalEndExclusive).millis()),
    ee.Date(CONFIG.globalEndExclusive),
    endExclusive
  ));

  var local = s1
    .filterBounds(st.geometry())
    .filterDate(start, endExclusive);

  return local.toList(local.size()).map(function(imgObj) {
    return extractSceneFeature(st, ee.Image(imgObj));
  });
});

var output = ee.FeatureCollection(ee.List(nested).flatten());

var manifest = ee.FeatureCollection([
  ee.Feature(null, {
    step_id: 'A-01',
    version: CONFIG.version,
    source_collection: CONFIG.sourceCollection,
    station_count: stations.size(),
    primary_core_station_count:
      stations.filter(ee.Filter.eq('station_role', 'PRIMARY_CORE')).size(),
    supporting_station_count:
      stations.filter(ee.Filter.eq('station_role', 'SUPPORTING')).size(),
    global_start: CONFIG.globalStart,
    global_end_exclusive: CONFIG.globalEndExclusive,
    instrument_mode: 'IW',
    resolution_meters: CONFIG.scaleMeters,
    required_polarisation: 'VV+VH',
    primary_buffer_m: CONFIG.bufferPrimaryM,
    sensitivity_buffer_m: CONFIG.bufferSensitivityM,
    output_rows: output.size(),
    note_1: '30 m median is primary spatial support; 50 m median is sensitivity.',
    note_2: 'No model fitting and no temporal field join are performed in GEE.',
    note_3: 'Orbit pass and relative orbit are retained for geometry control.',
    note_4: 'Backscatter is from COPERNICUS/S1_GRD dB imagery.'
  })
]);

print('A-01 CONFIG', CONFIG);
print('Retained stations — expected 12', stations.size());
print('Primary core — expected 8',
      stations.filter(ee.Filter.eq('station_role', 'PRIMARY_CORE')).size());
print('Supporting — expected 4',
      stations.filter(ee.Filter.eq('station_role', 'SUPPORTING')).size());
print('Output rows', output.size());
print('Output preview', output.limit(20));
print('Manifest', manifest);

Map.centerObject(stations, 7);
Map.addLayer(
  stations.filter(ee.Filter.eq('station_role', 'PRIMARY_CORE')),
  {color: 'red'},
  '8 PRIMARY_CORE'
);
Map.addLayer(
  stations.filter(ee.Filter.eq('station_role', 'SUPPORTING')),
  {color: 'yellow'},
  '4 SUPPORTING'
);

Export.table.toDrive({
  collection: output,
  description: 'A01_S1_BACKSCATTER_BRGM12_2019_2023_V100',
  folder: CONFIG.driveFolder,
  fileNamePrefix: 'A01_S1_BACKSCATTER_BRGM12_2019_2023_V100',
  fileFormat: 'CSV'
});

Export.table.toDrive({
  collection: manifest,
  description: 'A01_S1_BACKSCATTER_RUN_MANIFEST_V100',
  folder: CONFIG.driveFolder,
  fileNamePrefix: 'A01_S1_BACKSCATTER_RUN_MANIFEST_V100',
  fileFormat: 'CSV'
});
