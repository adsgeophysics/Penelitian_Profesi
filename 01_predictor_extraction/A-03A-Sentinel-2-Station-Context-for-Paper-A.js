/*
A-03A — Sentinel-2 Station Context for Paper A
Version V100

Purpose:
- Produce annual Sentinel-2 optical/vegetation/moisture context for the
  12 retained SPALAGA stations, 2019–2023.
- This is NOT the final Paper-B land-cover classification.
- Dynamic World is used only as a preliminary Sentinel-2-derived cover context,
  not as field ground truth.

Exports:
1) A03A_S2_STATION_CONTEXT_BRGM12_2019_2023_V100.csv
2) A03A_S2_STATION_CONTEXT_RUN_MANIFEST_V100.csv
*/

var CONFIG = {
  s2: 'COPERNICUS/S2_SR_HARMONIZED',
  dw: 'GOOGLE/DYNAMICWORLD/V1',
  startYear: 2019,
  endYear: 2023,
  bufferM: 50,
  scaleM: 10,
  driveFolder: 'Penelitian2026',
  version: 'A03A_S2_CONTEXT_V100'
};

// station_code, name, lon, lat, role
var stationRows = [
  ['BRG_160205_02','Tanjung Serang',104.911705,-3.447086,'PRIMARY_CORE'],
  ['BRG_160214_02','Padang Sugihan 2',105.216600,-3.090585,'PRIMARY_CORE'],
  ['BRG_160214_03','Padang Sugihan 3',105.232200,-3.019940,'PRIMARY_CORE'],
  ['BRG_160224_01','Cinta Jaya 1',104.977500,-3.392495,'PRIMARY_CORE'],
  ['BRG_160224_02','Cinta Jaya 2',104.965100,-3.478628,'PRIMARY_CORE'],
  ['BRG_160224_03','Cinta Jaya 3',104.964700,-3.432265,'PRIMARY_CORE'],
  ['BRG_160609_01','Muara Medak 1',103.928600,-1.795132,'PRIMARY_CORE'],
  ['BRG_160611_01','Karang Agung',104.411300,-2.281653,'PRIMARY_CORE'],

  ['BRG_160205_01','Kedaton',104.879161,-3.401407,'SUPPORTING'],
  ['BRG_160214_01','Air Sugihan 1',105.215600,-3.105565,'SUPPORTING'],
  ['BRG_160219_02','Air Rumbai',105.121000,-3.124240,'SUPPORTING'],
  ['BRG_160609_02','Muara Medak 2',103.902000,-1.854130,'SUPPORTING']
];

var stations = ee.FeatureCollection(stationRows.map(function(r) {
  return ee.Feature(ee.Geometry.Point([r[2],r[3]]), {
    station_code:r[0], station_name:r[1],
    longitude:r[2], latitude:r[3], station_role:r[4]
  });
}));

function maskS2(img) {
  var scl = img.select('SCL');
  var mask = scl.neq(0)
    .and(scl.neq(1))
    .and(scl.neq(3))
    .and(scl.neq(8))
    .and(scl.neq(9))
    .and(scl.neq(10))
    .and(scl.neq(11));

  return img.updateMask(mask)
    .select(
      ['B2','B3','B4','B5','B8','B8A','B11','B12'],
      ['blue','green','red','rededge1','nir','nir_narrow','swir1','swir2']
    )
    .multiply(0.0001)
    .copyProperties(img, ['system:time_start']);
}

function addIndices(img) {
  var ndvi = img.normalizedDifference(['nir','red']).rename('NDVI');
  var ndmi = img.normalizedDifference(['nir','swir1']).rename('NDMI');
  var mndwi = img.normalizedDifference(['green','swir1']).rename('MNDWI');
  var nbr = img.normalizedDifference(['nir','swir2']).rename('NBR');
  var ndre = img.normalizedDifference(['nir_narrow','rededge1']).rename('NDRE');

  var bsi = img.expression(
    '((SWIR + RED) - (NIR + BLUE)) / ((SWIR + RED) + (NIR + BLUE))',
    {
      SWIR:img.select('swir1'),
      RED:img.select('red'),
      NIR:img.select('nir'),
      BLUE:img.select('blue')
    }
  ).rename('BSI');

  return img.addBands([ndvi,ndmi,mndwi,nbr,ndre,bsi]);
}

var years = ee.List.sequence(CONFIG.startYear, CONFIG.endYear);

var nested = stations.toList(stations.size()).map(function(stObj) {
  var st = ee.Feature(stObj);
  var geom = st.geometry().buffer(CONFIG.bufferM);

  return years.map(function(yObj) {
    var y = ee.Number(yObj);
    var start = ee.Date.fromYMD(y,1,1);
    var end = start.advance(1,'year');

    var s2raw = ee.ImageCollection(CONFIG.s2)
      .filterBounds(geom)
      .filterDate(start,end);

    var s2clean = s2raw.map(maskS2).map(addIndices);
    var comp = s2clean.median();

    var optical = comp.reduceRegion({
      reducer: ee.Reducer.median()
        .combine({reducer2:ee.Reducer.mean(), sharedInputs:true})
        .combine({reducer2:ee.Reducer.stdDev(), sharedInputs:true}),
      geometry: geom,
      scale: CONFIG.scaleM,
      maxPixels: 20000,
      tileScale: 2
    });

    var dw = ee.ImageCollection(CONFIG.dw)
      .filterBounds(geom)
      .filterDate(start,end);

    var dwLabel = dw.select('label').mode();

    var dwProbBands = [
      'water','trees','grass','flooded_vegetation',
      'crops','shrub_and_scrub','built','bare'
    ];

    var dwProb = dw.select(dwProbBands).mean();

    var dwLabelStats = dwLabel.reduceRegion({
      reducer:ee.Reducer.mode(),
      geometry:geom,
      scale:10,
      maxPixels:20000
    });

    var dwProbStats = dwProb.reduceRegion({
      reducer:ee.Reducer.mean(),
      geometry:geom,
      scale:10,
      maxPixels:20000
    });

    return ee.Feature(null, {
      station_code:st.get('station_code'),
      station_name:st.get('station_name'),
      station_role:st.get('station_role'),
      longitude:st.get('longitude'),
      latitude:st.get('latitude'),
      year:y,

      s2_raw_scene_count:s2raw.size(),
      s2_clean_collection_count:s2clean.size(),

      ndvi_median:optical.get('NDVI_median'),
      ndvi_mean:optical.get('NDVI_mean'),
      ndvi_stddev:optical.get('NDVI_stdDev'),

      ndmi_median:optical.get('NDMI_median'),
      ndmi_mean:optical.get('NDMI_mean'),
      ndmi_stddev:optical.get('NDMI_stdDev'),

      mndwi_median:optical.get('MNDWI_median'),
      mndwi_mean:optical.get('MNDWI_mean'),
      mndwi_stddev:optical.get('MNDWI_stdDev'),

      nbr_median:optical.get('NBR_median'),
      nbr_mean:optical.get('NBR_mean'),
      nbr_stddev:optical.get('NBR_stdDev'),

      ndre_median:optical.get('NDRE_median'),
      ndre_mean:optical.get('NDRE_mean'),
      ndre_stddev:optical.get('NDRE_stdDev'),

      bsi_median:optical.get('BSI_median'),
      bsi_mean:optical.get('BSI_mean'),
      bsi_stddev:optical.get('BSI_stdDev'),

      blue_median:optical.get('blue_median'),
      green_median:optical.get('green_median'),
      red_median:optical.get('red_median'),
      nir_median:optical.get('nir_median'),
      swir1_median:optical.get('swir1_median'),
      swir2_median:optical.get('swir2_median'),

      dw_label_mode:dwLabelStats.get('label'),
      dw_water_prob:dwProbStats.get('water'),
      dw_trees_prob:dwProbStats.get('trees'),
      dw_grass_prob:dwProbStats.get('grass'),
      dw_flooded_vegetation_prob:dwProbStats.get('flooded_vegetation'),
      dw_crops_prob:dwProbStats.get('crops'),
      dw_shrub_scrub_prob:dwProbStats.get('shrub_and_scrub'),
      dw_built_prob:dwProbStats.get('built'),
      dw_bare_prob:dwProbStats.get('bare'),

      audit_version:CONFIG.version
    });
  });
});

var output = ee.FeatureCollection(ee.List(nested).flatten());

var manifest = ee.FeatureCollection([
  ee.Feature(null,{
    step_id:'A-03A',
    version:CONFIG.version,
    s2_collection:CONFIG.s2,
    dynamic_world_collection:CONFIG.dw,
    start_year:CONFIG.startYear,
    end_year:CONFIG.endYear,
    station_count:stations.size(),
    expected_output_rows:stations.size().multiply(
      ee.Number(CONFIG.endYear).subtract(CONFIG.startYear).add(1)
    ),
    buffer_m:CONFIG.bufferM,
    scale_m:CONFIG.scaleM,
    note_1:'This is station context for Paper A, not final Paper-B LULC.',
    note_2:'Dynamic World is a preliminary Sentinel-2-derived cover context, not field truth.',
    note_3:'Final land-cover classification and accuracy assessment remain a separate B-01 task.'
  })
]);

print('Stations expected 12',stations.size());
print('Rows expected 60',output.size());
print('Preview',output.limit(20));
print('Manifest',manifest);

Map.centerObject(stations,7);
Map.addLayer(stations,{color:'red'},'A03A stations');

Export.table.toDrive({
  collection:output,
  description:'A03A_S2_STATION_CONTEXT_BRGM12_2019_2023_V100',
  folder:CONFIG.driveFolder,
  fileNamePrefix:'A03A_S2_STATION_CONTEXT_BRGM12_2019_2023_V100',
  fileFormat:'CSV'
});

Export.table.toDrive({
  collection:manifest,
  description:'A03A_S2_STATION_CONTEXT_RUN_MANIFEST_V100',
  folder:CONFIG.driveFolder,
  fileNamePrefix:'A03A_S2_STATION_CONTEXT_RUN_MANIFEST_V100',
  fileFormat:'CSV'
});
