/*
A-06 — SMAP L4 V8 Hydrological Anchor at Sentinel-1 Acquisition Times
Version: V100

Purpose:
- For the same 12 retained SIPALAGA stations and Sentinel-1 station-scenes,
  attach the nearest SMAP L4 Version 8 3-hourly hydrological state.
- SMAP is a coarse hydrological anchor / benchmark, NOT field truth.
- Key peat-specific variable:
  depth_to_water_table_from_surface_in_peat
  (positive above ground surface, negative below ground surface).

Expected output:
1) A06_S1_SMAP_BRGM12_2019_2023_V100.csv
2) A06_S1_SMAP_RUN_MANIFEST_V100.csv
*/

var CONFIG = {
  s1Collection: 'COPERNICUS/S1_GRD',
  smapCollection: 'NASA/SMAP/SPL4SMGP/008',
  globalStart: '2019-01-01',
  globalEndExclusive: '2023-06-16',
  timezone: 'Asia/Jakarta',
  wibOffsetHours: 7,
  driveFolder: 'Penelitian2026',
  version: 'A06_S1_SMAP_V100',
  s1ScaleM: 10,
  smapScaleM: 11000,
  smapSearchHours: 3
};

// station_code, station_name, lon, lat, field_start, field_end, role
var stationRows = [
  ['BRG_160205_02','Tanjung Serang',104.911705,-3.447086,'2018-11-28','2022-03-19','PRIMARY_CORE'],
  ['BRG_160214_02','Padang Sugihan 2',105.216600,-3.090585,'2018-11-10','2022-03-08','PRIMARY_CORE'],
  ['BRG_160214_03','Padang Sugihan 3',105.232200,-3.019940,'2018-11-10','2023-05-19','PRIMARY_CORE'],
  ['BRG_160224_01','Cinta Jaya 1',104.977500,-3.392495,'2018-11-10','2021-07-31','PRIMARY_CORE'],
  ['BRG_160224_02','Cinta Jaya 2',104.965100,-3.478628,'2018-11-10','2023-06-15','PRIMARY_CORE'],
  ['BRG_160224_03','Cinta Jaya 3',104.964700,-3.432265,'2018-11-10','2022-12-11','PRIMARY_CORE'],
  ['BRG_160609_01','Muara Medak 1',103.928600,-1.795132,'2018-11-23','2022-12-03','PRIMARY_CORE'],
  ['BRG_160611_01','Karang Agung',104.411300,-2.281653,'2018-11-19','2023-04-16','PRIMARY_CORE'],

  ['BRG_160205_01','Kedaton',104.879161,-3.401407,'2018-11-09','2019-12-14','SUPPORTING'],
  ['BRG_160214_01','Air Sugihan 1',105.215600,-3.105565,'2018-11-10','2019-09-18','SUPPORTING'],
  ['BRG_160219_02','Air Rumbai',105.121000,-3.124240,'2018-11-09','2022-03-23','SUPPORTING'],
  ['BRG_160609_02','Muara Medak 2',103.902000,-1.854130,'2018-11-24','2019-07-11','SUPPORTING']
];

var stations = ee.FeatureCollection(stationRows.map(function(r) {
  return ee.Feature(
    ee.Geometry.Point([r[2], r[3]]),
    {
      station_code:r[0],
      station_name:r[1],
      longitude:r[2],
      latitude:r[3],
      field_start:r[4],
      field_end:r[5],
      station_role:r[6]
    }
  );
}));

var s1 = ee.ImageCollection(CONFIG.s1Collection)
  .filterDate(CONFIG.globalStart, CONFIG.globalEndExclusive)
  .filter(ee.Filter.eq('instrumentMode', 'IW'))
  .filter(ee.Filter.eq('resolution_meters', CONFIG.s1ScaleM))
  .filter(ee.Filter.listContains('transmitterReceiverPolarisation', 'VV'))
  .filter(ee.Filter.listContains('transmitterReceiverPolarisation', 'VH'));

var smap = ee.ImageCollection(CONFIG.smapCollection)
  .filterDate(CONFIG.globalStart, CONFIG.globalEndExclusive);

var SMAP_BANDS = [
  'sm_surface',
  'sm_rootzone',
  'sm_profile',
  'sm_surface_wetness',
  'sm_rootzone_wetness',
  'sm_profile_wetness',
  'sm_rootzone_pctl',
  'sm_profile_pctl',
  'depth_to_water_table_from_surface_in_peat',
  'land_fraction_saturated',
  'surface_temp',
  'vegetation_greenness_fraction',
  'leaf_area_index'
];

function outageFlag(dateObj) {
  var d = ee.Date(dateObj);

  var outage2019 = d.millis().gte(ee.Date('2019-06-19').millis())
    .and(d.millis().lt(ee.Date('2019-07-24').millis()));

  var outage2022 = d.millis().gte(ee.Date('2022-08-06').millis())
    .and(d.millis().lt(ee.Date('2022-09-21').millis()));

  return ee.Number(ee.Algorithms.If(outage2019.or(outage2022), 1, 0));
}

function nearestSmapToS1(st, s1img) {
  st = ee.Feature(st);
  s1img = ee.Image(s1img);

  var s1Time = ee.Date(s1img.get('system:time_start'));
  var searchStart = s1Time.advance(-CONFIG.smapSearchHours, 'hour');
  var searchEnd = s1Time.advance(CONFIG.smapSearchHours, 'hour');

  var candidates = smap.filterDate(searchStart, searchEnd)
    .map(function(im) {
      im = ee.Image(im);
      var dt = ee.Number(im.get('system:time_start'))
        .subtract(s1Time.millis())
        .abs();
      return im.set('abs_time_delta_ms', dt);
    })
    .sort('abs_time_delta_ms');

  // SMAP L4 has regular 3-hourly cadence in this study period.
  var smapImg = ee.Image(candidates.first());
  var smapTime = ee.Date(smapImg.get('system:time_start'));

  var vals = smapImg.select(SMAP_BANDS).reduceRegion({
    reducer: ee.Reducer.first(),
    geometry: st.geometry(),
    scale: CONFIG.smapScaleM,
    maxPixels: 1000
  });

  var dtHours = ee.Number(
    ee.Number(smapImg.get('system:time_start'))
      .subtract(s1Time.millis())
      .abs()
  ).divide(1000 * 60 * 60);

  var s1Wib = s1Time.advance(CONFIG.wibOffsetHours, 'hour');
  var smapWib = smapTime.advance(CONFIG.wibOffsetHours, 'hour');

  return ee.Feature(null, {
    station_code:st.get('station_code'),
    station_name:st.get('station_name'),
    station_role:st.get('station_role'),
    longitude:st.get('longitude'),
    latitude:st.get('latitude'),
    field_start:st.get('field_start'),
    field_end:st.get('field_end'),

    s1_image_id:s1img.id(),
    s1_system_index:s1img.get('system:index'),
    s1_acquisition_utc:s1Time.format('YYYY-MM-dd HH:mm:ss','UTC'),
    s1_acquisition_wib:s1Wib.format('YYYY-MM-dd HH:mm:ss',CONFIG.timezone),
    s1_orbit_pass:s1img.get('orbitProperties_pass'),
    s1_relative_orbit:s1img.get('relativeOrbitNumber_start'),

    smap_image_id:smapImg.id(),
    smap_system_index:smapImg.get('system:index'),
    smap_acquisition_utc:smapTime.format('YYYY-MM-dd HH:mm:ss','UTC'),
    smap_acquisition_wib:smapWib.format('YYYY-MM-dd HH:mm:ss',CONFIG.timezone),
    smap_abs_time_delta_hours:dtHours,
    smap_instrument_outage_flag:outageFlag(smapTime),

    smap_sm_surface:vals.get('sm_surface'),
    smap_sm_rootzone:vals.get('sm_rootzone'),
    smap_sm_profile:vals.get('sm_profile'),

    smap_surface_wetness:vals.get('sm_surface_wetness'),
    smap_rootzone_wetness:vals.get('sm_rootzone_wetness'),
    smap_profile_wetness:vals.get('sm_profile_wetness'),

    smap_rootzone_pctl:vals.get('sm_rootzone_pctl'),
    smap_profile_pctl:vals.get('sm_profile_pctl'),

    smap_dtw_peat_m:vals.get('depth_to_water_table_from_surface_in_peat'),
    smap_land_fraction_saturated:vals.get('land_fraction_saturated'),

    smap_surface_temp_K:vals.get('surface_temp'),
    smap_vegetation_greenness_fraction:vals.get('vegetation_greenness_fraction'),
    smap_leaf_area_index:vals.get('leaf_area_index'),

    audit_version:CONFIG.version
  });
}

var nested = stations.toList(stations.size()).map(function(stObj) {
  var st = ee.Feature(stObj);

  var start = ee.Date(st.get('field_start'));
  var endExclusive = ee.Date(st.get('field_end')).advance(1,'day');

  start = ee.Date(ee.Algorithms.If(
    start.millis().lt(ee.Date(CONFIG.globalStart).millis()),
    ee.Date(CONFIG.globalStart),
    start
  ));

  endExclusive = ee.Date(ee.Algorithms.If(
    endExclusive.millis().gt(ee.Date(CONFIG.globalEndExclusive).millis()),
    ee.Date(CONFIG.globalEndExclusive),
    endExclusive
  ));

  var localS1 = s1
    .filterBounds(st.geometry())
    .filterDate(start, endExclusive);

  return localS1.toList(localS1.size()).map(function(imgObj) {
    return nearestSmapToS1(st, ee.Image(imgObj));
  });
});

var output = ee.FeatureCollection(ee.List(nested).flatten());

var manifest = ee.FeatureCollection([
  ee.Feature(null,{
    step_id:'A-06',
    version:CONFIG.version,
    s1_collection:CONFIG.s1Collection,
    smap_collection:CONFIG.smapCollection,
    station_count:stations.size(),
    primary_core_station_count:
      stations.filter(ee.Filter.eq('station_role','PRIMARY_CORE')).size(),
    supporting_station_count:
      stations.filter(ee.Filter.eq('station_role','SUPPORTING')).size(),
    smap_search_window_hours_plusminus:CONFIG.smapSearchHours,
    smap_scale_m:CONFIG.smapScaleM,
    output_rows:output.size(),
    note_1:'SMAP L4 V8 is used as a coarse hydrological anchor/benchmark, not field truth.',
    note_2:'The peat-specific SMAP water-table variable uses positive values above the ground surface and negative values below.',
    note_3:'Instrument-outage flag marks 2019-06-19 to 2019-07-23 and 2022-08-06 to 2022-09-20.',
    note_4:'Nearest SMAP 3-hourly record is linked to each Sentinel-1 acquisition.'
  })
]);

print('Stations expected 12',stations.size());
print('Primary core expected 8',
      stations.filter(ee.Filter.eq('station_role','PRIMARY_CORE')).size());
print('Supporting expected 4',
      stations.filter(ee.Filter.eq('station_role','SUPPORTING')).size());
print('Output rows expected approximately A-01 total (~2154)',output.size());
print('Preview',output.limit(20));
print('Manifest',manifest);

Map.centerObject(stations,7);
Map.addLayer(
  stations.filter(ee.Filter.eq('station_role','PRIMARY_CORE')),
  {color:'red'},
  'A06 PRIMARY_CORE'
);
Map.addLayer(
  stations.filter(ee.Filter.eq('station_role','SUPPORTING')),
  {color:'yellow'},
  'A06 SUPPORTING'
);

Export.table.toDrive({
  collection:output,
  description:'A06_S1_SMAP_BRGM12_2019_2023_V100',
  folder:CONFIG.driveFolder,
  fileNamePrefix:'A06_S1_SMAP_BRGM12_2019_2023_V100',
  fileFormat:'CSV'
});

Export.table.toDrive({
  collection:manifest,
  description:'A06_S1_SMAP_RUN_MANIFEST_V100',
  folder:CONFIG.driveFolder,
  fileNamePrefix:'A06_S1_SMAP_RUN_MANIFEST_V100',
  fileFormat:'CSV'
});
