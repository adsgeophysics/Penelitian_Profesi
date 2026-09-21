// AUDIT-02 Sentinel-1 Acquisition Audit
// Version V101 — fixes nested List<List<Feature>> error from V100.

var CONFIG = {
  sourceCollection: 'COPERNICUS/S1_GRD',
  startDate: '2019-01-01',
  endExclusive: '2023-06-16',
  timezone: 'Asia/Jakarta',
  wibOffsetHours: 7,
  driveFolder: 'Penelitian2026',
  version: 'AUDIT02_S1_V101',
  instrumentMode: 'IW',
  resolutionMeters: 10,
  expectedStationCount: 16
};

var stationRows = [
  ['BRG_160611_01', 'Karang Agung',      104.411300, -2.281653],
  ['BRG_160224_03', 'Cinta Jaya 3',     104.964700, -3.432265],
  ['BRG_160224_02', 'Cinta Jaya 2',     104.965100, -3.478628],
  ['BRG_160224_01', 'Cinta Jaya 1',     104.977500, -3.392495],
  ['BRG_160219_02', 'Air Rumbai',       105.121000, -3.124240],
  ['BRG2',          'Pulai Gading',      104.061544, -1.761597],
  ['BRG_160205_02', 'Tanjung Serang',   104.911705, -3.447086],
  ['SELEH1',        'Seleh 1',           104.920971, -3.458371],
  ['SELEH2',        'Seleh 2',           105.143439, -2.676852],
  ['BRG_160214_03', 'Padang Sugihan 3', 105.232200, -3.019940],
  ['BRG_160214_02', 'Padang Sugihan 2', 105.216600, -3.090585],
  ['BRG_160214_01', 'Air Sugihan 1',    105.215600, -3.105565],
  ['BRG_160609_02', 'Muara Medak 2',    103.902000, -1.854130],
  ['MUBA2',         'Kepayang',          104.194887, -2.185613],
  ['BRG_160609_01', 'Muara Medak 1',    103.928600, -1.795132],
  ['BRG_160205_01', 'Kedaton',           104.879161, -3.401407]
];

var stations = ee.FeatureCollection(stationRows.map(function(r) {
  return ee.Feature(
    ee.Geometry.Point([r[2], r[3]]),
    {
      station_code: r[0],
      station_name: r[1],
      longitude: r[2],
      latitude: r[3]
    }
  );
}));

var s1 = ee.ImageCollection(CONFIG.sourceCollection)
  .filterDate(CONFIG.startDate, CONFIG.endExclusive)
  .filter(ee.Filter.eq('instrumentMode', CONFIG.instrumentMode))
  .filter(ee.Filter.eq('resolution_meters', CONFIG.resolutionMeters))
  .filter(ee.Filter.listContains('transmitterReceiverPolarisation', 'VV'))
  .filter(ee.Filter.listContains('transmitterReceiverPolarisation', 'VH'));

// -----------------------------------------------------------------------------
// Detailed station × acquisition table.
// FIX: convert ImageCollection to List before mapping to Features.
// -----------------------------------------------------------------------------
var detailedNested = stations.toList(stations.size()).map(function(stObj) {
  var st = ee.Feature(stObj);
  var local = s1.filterBounds(st.geometry());

  return local.toList(local.size()).map(function(imgObj) {
    var img = ee.Image(imgObj);
    var tUtc = ee.Date(img.get('system:time_start'));
    var tWib = tUtc.advance(CONFIG.wibOffsetHours, 'hour');

    return ee.Feature(null, {
      station_code: st.get('station_code'),
      station_name: st.get('station_name'),
      longitude: st.get('longitude'),
      latitude: st.get('latitude'),

      image_id: img.id(),
      system_index: img.get('system:index'),
      acquisition_utc: tUtc.format('YYYY-MM-dd HH:mm:ss', 'UTC'),
      acquisition_wib: tWib.format('YYYY-MM-dd HH:mm:ss', CONFIG.timezone),
      acquisition_date_wib: tWib.format('YYYY-MM-dd', CONFIG.timezone),
      year_wib: ee.Number.parse(tWib.format('YYYY', CONFIG.timezone)),
      month_wib: ee.Number.parse(tWib.format('MM', CONFIG.timezone)),

      platform_number: img.get('platform_number'),
      orbit_pass: img.get('orbitProperties_pass'),
      relative_orbit_start: img.get('relativeOrbitNumber_start'),
      absolute_orbit_start: img.get('orbitNumber_start'),
      instrument_mode: img.get('instrumentMode'),
      resolution_m: img.get('resolution_meters'),
      polarisation: ee.List(img.get('transmitterReceiverPolarisation')).join('+'),
      product_type: img.get('productType'),
      slice_number: img.get('sliceNumber'),
      total_slices: img.get('totalSlices'),
      audit_version: CONFIG.version
    });
  });
});

var detailed = ee.FeatureCollection(ee.List(detailedNested).flatten());

// -----------------------------------------------------------------------------
// Station × year summary.
// FIX: flatten nested feature lists BEFORE FeatureCollection.
// -----------------------------------------------------------------------------
var years = ee.List.sequence(2019, 2023);

var stationYearNested = stations.toList(stations.size()).map(function(stObj) {
  var st = ee.Feature(stObj);

  return years.map(function(yObj) {
    var y = ee.Number(yObj);
    var start = ee.Date.fromYMD(y, 1, 1);
    var normalEnd = start.advance(1, 'year');

    var end = ee.Date(ee.Algorithms.If(
      y.eq(2023),
      ee.Date(CONFIG.endExclusive),
      normalEnd
    ));

    var c = s1
      .filterBounds(st.geometry())
      .filterDate(start, end);

    var relOrbits = ee.List(
      c.aggregate_array('relativeOrbitNumber_start')
    ).distinct().sort();

    return ee.Feature(null, {
      station_code: st.get('station_code'),
      station_name: st.get('station_name'),
      year: y,
      date_start: start.format('YYYY-MM-dd'),
      date_end_exclusive: end.format('YYYY-MM-dd'),

      acquisition_count: c.size(),
      ascending_count:
        c.filter(ee.Filter.eq('orbitProperties_pass', 'ASCENDING')).size(),
      descending_count:
        c.filter(ee.Filter.eq('orbitProperties_pass', 'DESCENDING')).size(),
      sentinel1A_count:
        c.filter(ee.Filter.eq('platform_number', 'A')).size(),
      sentinel1B_count:
        c.filter(ee.Filter.eq('platform_number', 'B')).size(),

      relative_orbit_count: relOrbits.size(),
      relative_orbits: relOrbits.join('|'),
      has_any: ee.Number(c.size()).gt(0),
      audit_version: CONFIG.version
    });
  });
});

var stationYearSummary = ee.FeatureCollection(
  ee.List(stationYearNested).flatten()
);

// -----------------------------------------------------------------------------
// Overall station summary.
// -----------------------------------------------------------------------------
var stationSummary = stations.map(function(st) {
  var c = s1.filterBounds(st.geometry());
  var times = ee.List(c.aggregate_array('system:time_start')).sort();

  var firstWib = ee.Algorithms.If(
    c.size().gt(0),
    ee.Date(times.get(0))
      .advance(CONFIG.wibOffsetHours, 'hour')
      .format('YYYY-MM-dd HH:mm:ss', CONFIG.timezone),
    null
  );

  var lastWib = ee.Algorithms.If(
    c.size().gt(0),
    ee.Date(times.get(times.size().subtract(1)))
      .advance(CONFIG.wibOffsetHours, 'hour')
      .format('YYYY-MM-dd HH:mm:ss', CONFIG.timezone),
    null
  );

  var relOrbits = ee.List(
    c.aggregate_array('relativeOrbitNumber_start')
  ).distinct().sort();

  return ee.Feature(null, {
    station_code: st.get('station_code'),
    station_name: st.get('station_name'),
    longitude: st.get('longitude'),
    latitude: st.get('latitude'),
    acquisition_count: c.size(),
    first_acquisition_wib: firstWib,
    last_acquisition_wib: lastWib,
    ascending_count:
      c.filter(ee.Filter.eq('orbitProperties_pass', 'ASCENDING')).size(),
    descending_count:
      c.filter(ee.Filter.eq('orbitProperties_pass', 'DESCENDING')).size(),
    sentinel1A_count:
      c.filter(ee.Filter.eq('platform_number', 'A')).size(),
    sentinel1B_count:
      c.filter(ee.Filter.eq('platform_number', 'B')).size(),
    relative_orbit_count: relOrbits.size(),
    relative_orbits: relOrbits.join('|'),
    audit_version: CONFIG.version
  });
});

var manifest = ee.FeatureCollection([
  ee.Feature(null, {
    audit_id: 'AUDIT-02',
    version: CONFIG.version,
    source_collection: CONFIG.sourceCollection,
    start_date: CONFIG.startDate,
    end_exclusive: CONFIG.endExclusive,
    timezone: CONFIG.timezone,
    wib_offset_hours: CONFIG.wibOffsetHours,
    station_count_expected: CONFIG.expectedStationCount,
    station_count_actual: stations.size(),
    instrument_mode: CONFIG.instrumentMode,
    resolution_meters: CONFIG.resolutionMeters,
    required_polarisation: 'VV+VH',
    detailed_rows: detailed.size(),
    station_summary_rows: stationSummary.size(),
    station_year_rows: stationYearSummary.size(),
    note_1: 'V101 fixes nested List<List<Feature>> error in V100.',
    note_2: 'Acquisition audit only; no VV/VH spatial reducer applied.',
    note_3: 'Final field matching will test same-day, +/-1d, and +/-2d.',
    note_4: 'Ascending/descending and relative orbit are retained separately.'
  })
]);

print('AUDIT-02 CONFIG', CONFIG);
print('Station count — expected 16', stations.size());
print('Detailed station-scene rows', detailed.size());
print('Station summary rows — expected 16', stationSummary.size());
print('Station-year rows — expected 80', stationYearSummary.size());

print('Station summary preview', stationSummary.limit(16));
print('Station-year preview', stationYearSummary.limit(20));
print('Detailed preview', detailed.limit(20));
print('Run manifest', manifest);

Map.centerObject(stations, 7);
Map.addLayer(stations, {color: 'red'}, '16 BRGM/SPALAGA stations');

Export.table.toDrive({
  collection: detailed,
  description: 'AUDIT02_S1_DETAILED_ACQUISITIONS_BRGM16_2019_2023_V101',
  folder: CONFIG.driveFolder,
  fileNamePrefix: 'AUDIT02_S1_DETAILED_ACQUISITIONS_BRGM16_2019_2023_V101',
  fileFormat: 'CSV'
});

Export.table.toDrive({
  collection: stationSummary,
  description: 'AUDIT02_S1_STATION_SUMMARY_BRGM16_2019_2023_V101',
  folder: CONFIG.driveFolder,
  fileNamePrefix: 'AUDIT02_S1_STATION_SUMMARY_BRGM16_2019_2023_V101',
  fileFormat: 'CSV'
});

Export.table.toDrive({
  collection: stationYearSummary,
  description: 'AUDIT02_S1_STATION_YEAR_SUMMARY_BRGM16_2019_2023_V101',
  folder: CONFIG.driveFolder,
  fileNamePrefix: 'AUDIT02_S1_STATION_YEAR_SUMMARY_BRGM16_2019_2023_V101',
  fileFormat: 'CSV'
});

Export.table.toDrive({
  collection: manifest,
  description: 'AUDIT02_S1_RUN_MANIFEST_BRGM16_2019_2023_V101',
  folder: CONFIG.driveFolder,
  fileNamePrefix: 'AUDIT02_S1_RUN_MANIFEST_BRGM16_2019_2023_V101',
  fileFormat: 'CSV'
});
