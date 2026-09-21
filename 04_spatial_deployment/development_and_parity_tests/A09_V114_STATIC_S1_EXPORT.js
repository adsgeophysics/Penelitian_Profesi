/*
A-09 V114 — STATIC SENTINEL-1 EXPORT TEST
=========================================
Purpose:
Test the final hybrid architecture with the LIGHTEST useful Sentinel-1 product.

GEE computes ONLY current-scene static 50-m support features:
  1. vv_median_50m_db
  2. vh_median_50m_db
  3. vv_minus_vh_50m_db
  4. vh_vv_ratio_linear_50m
  5. rvi_50m
  6. angle_median_50m_deg

NO temporal history.
NO GPM.
NO SMAP.
NO Ridge inference.
NO detailed KHG geometry.

Temporal features will be reconstructed OFFLINE from the exported sequence of
same-orbit static rasters. This preserves the A08 feature definitions while
removing the Earth Engine memory bottleneck.

FIRST TEST:
  Tile   : T05_NC
  Scene  : S02 / relative orbit 120
  Date   : 2019-04-02 22:40:49 UTC
  Output : 50 m GeoTIFF, 6 bands
*/

var CONFIG = {
  s1Collection: 'COPERNICUS/S1_GRD',
  driveFolder: 'Penelitian2026',
  exportCrs: 'EPSG:32748',
  exportScaleM: 50,
  supportRadiusM: 50,
  maxPixels: 1e10,
  version: 'A09_V114'
};

var TILE = {
  id: 'T05_NC',
  rect: [103.833333, -3.15, 105.166667, -1.5]
};

// Validated V110 scene S02.
var SCENE_INDEX =
  'S1A_IW_GRDH_1SDV_20190402T224049_20190402T224114_026617_02FC54_6C84';

var tileGeom = ee.Geometry.Rectangle(
  TILE.rect, 'EPSG:4326', false
);

// Small buffer only for the 50 m focal operation.
var workGeom = tileGeom.buffer(250, 10);

var s1 = ee.ImageCollection(CONFIG.s1Collection)
  .filter(ee.Filter.eq('instrumentMode', 'IW'))
  .filter(ee.Filter.eq('resolution_meters', 10))
  .filter(ee.Filter.listContains('transmitterReceiverPolarisation', 'VV'))
  .filter(ee.Filter.listContains('transmitterReceiverPolarisation', 'VH'))
  .filter(ee.Filter.eq('platform_number', 'A'));

var im = ee.Image(
  s1.filter(ee.Filter.eq('system:index', SCENE_INDEX)).first()
).clip(workGeom);

var vv = im.select('VV')
  .focal_median({
    radius: CONFIG.supportRadiusM,
    units: 'meters',
    kernelType: 'circle'
  })
  .rename('vv_median_50m_db');

var vh = im.select('VH')
  .focal_median({
    radius: CONFIG.supportRadiusM,
    units: 'meters',
    kernelType: 'circle'
  })
  .rename('vh_median_50m_db');

var angle = im.select('angle')
  .focal_median({
    radius: CONFIG.supportRadiusM,
    units: 'meters',
    kernelType: 'circle'
  })
  .rename('angle_median_50m_deg');

var diff = vv.subtract(vh)
  .rename('vv_minus_vh_50m_db');

var vvLin = ee.Image.constant(10).pow(vv.divide(10));
var vhLin = ee.Image.constant(10).pow(vh.divide(10));

var ratio = vhLin.divide(vvLin)
  .rename('vh_vv_ratio_linear_50m');

var rvi = vhLin.multiply(4)
  .divide(vvLin.add(vhLin))
  .rename('rvi_50m');

// Explicitly anchor the six-band stack to the source S1 projection.
// This only supplies projection metadata; focal values are unchanged.
var nativeProj = im.select('VV').projection();

var stack = vv
  .addBands(vh)
  .addBands(diff)
  .addBands(ratio)
  .addBands(rvi)
  .addBands(angle)
  .setDefaultProjection(nativeProj)
  .clip(tileGeom);

var qa = ee.FeatureCollection([
  ee.Feature(null, {
    scene_index: SCENE_INDEX,
    scene_found: s1.filter(ee.Filter.eq('system:index', SCENE_INDEX)).size(),
    relative_orbit: im.get('relativeOrbitNumber_start'),
    orbit_pass: im.get('orbitProperties_pass'),
    source_crs: nativeProj.crs(),
    source_nominal_scale_m: nativeProj.nominalScale(),
    output_scale_m: CONFIG.exportScaleM,
    support_radius_m: CONFIG.supportRadiusM,
    tile_id: TILE.id,
    temporal_features_in_gee: 0,
    gpm_in_gee: 0,
    smap_in_gee: 0,
    ridge_in_gee: 0,
    output_version: CONFIG.version
  })
]);

Export.table.toDrive({
  collection: qa,
  description: 'A09_V114_STATIC_S1_QA',
  folder: CONFIG.driveFolder,
  fileNamePrefix: 'A09_V114_STATIC_S1_QA',
  fileFormat: 'CSV'
});

Export.image.toDrive({
  image: stack.toFloat(),
  description: 'A09_V114_S02_STATIC_S1_50M_T05NC',
  folder: CONFIG.driveFolder,
  fileNamePrefix: 'A09_V114_S02_STATIC_S1_50M_T05NC',
  region: tileGeom,
  crs: CONFIG.exportCrs,
  scale: CONFIG.exportScaleM,
  maxPixels: CONFIG.maxPixels,
  fileFormat: 'GeoTIFF'
});

print('A09 V114 STATIC SENTINEL-1 TEST');
print('Scene index:', SCENE_INDEX);
print('Scene found:', s1.filter(ee.Filter.eq('system:index', SCENE_INDEX)).size());
print('Only 6 static S1 features are computed.');
print('No temporal history / GPM / SMAP / Ridge in this GEE task.');
print('Run QA first, then ONE raster task.');

Map.centerObject(tileGeom, 8);
Map.addLayer(tileGeom, {color:'blue'}, 'T05_NC');
