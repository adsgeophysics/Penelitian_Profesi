/*
A-09 V115 — SENTINEL-1 STATIC HISTORY EXPORT
=============================================
Purpose
-------
Export a chronological sequence of STATIC Sentinel-1 50-m-support rasters
for the same relative orbit used by the V114 success test.

Earth Engine does NOT compute:
- previous-scene temporal features,
- GPM,
- SMAP,
- Ridge GWL inference.

Offline Python will reconstruct, pixel-by-pixel:
- days_since_prev_same_orbit_50m
- delta_vv_prev_same_orbit_50m_db
- delta_vh_prev_same_orbit_50m_db
- delta_vvdiff_prev_same_orbit_50m_db
- vv_anom_prev3_same_orbit_50m_db
- vh_anom_prev3_same_orbit_50m_db
- n_prev3_history_50m

This preserves the corrected V110 concept:
"previous observation" means previous SAME-ORBIT observation that is valid at
that pixel, not simply the globally previous Sentinel-1 granule.

FIRST PRODUCTION-HISTORY TEST
-----------------------------
Tile          : T05_NC
Relative orbit: 120
History period: 2019-02-01 to 2019-04-13
Output        : one 6-band GeoTIFF per Sentinel-1 granule
Resolution    : 50 m
*/

var CONFIG = {
  s1Collection: 'COPERNICUS/S1_GRD',
  driveFolder: 'Penelitian2026',
  exportCrs: 'EPSG:32748',
  exportScaleM: 50,
  supportRadiusM: 50,
  maxPixels: 1e10,
  version: 'A09_V115',

  startDate: '2019-02-01',
  endExclusive: '2019-04-13',
  relativeOrbit: 120
};

var TILE = {
  id: 'T05_NC',
  rect: [103.833333, -3.15, 105.166667, -1.5]
};

var tileGeom = ee.Geometry.Rectangle(
  TILE.rect, 'EPSG:4326', false
);

// 250 m is ample for a 50-m focal radius while keeping the heavy graph small.
var workGeom = tileGeom.buffer(250, 10);

var s1 = ee.ImageCollection(CONFIG.s1Collection)
  .filterDate(CONFIG.startDate, CONFIG.endExclusive)
  .filterBounds(workGeom)
  .filter(ee.Filter.eq('instrumentMode', 'IW'))
  .filter(ee.Filter.eq('resolution_meters', 10))
  .filter(ee.Filter.listContains('transmitterReceiverPolarisation', 'VV'))
  .filter(ee.Filter.listContains('transmitterReceiverPolarisation', 'VH'))
  .filter(ee.Filter.eq('platform_number', 'A'))
  .filter(ee.Filter.eq(
    'relativeOrbitNumber_start',
    CONFIG.relativeOrbit
  ))
  .sort('system:time_start');

function static50(im) {
  im = ee.Image(im).clip(workGeom);

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

  var nativeProj = im.select('VV').projection();

  return vv
    .addBands(vh)
    .addBands(diff)
    .addBands(ratio)
    .addBands(rvi)
    .addBands(angle)
    .setDefaultProjection(nativeProj)
    .clip(tileGeom)
    .set({
      'system:time_start': im.get('system:time_start'),
      s1_system_index: im.get('system:index'),
      relative_orbit: im.get('relativeOrbitNumber_start'),
      orbit_pass: im.get('orbitProperties_pass'),
      export_version: CONFIG.version
    });
}

// -----------------------------------------------------------------------------
// CLIENT-SIDE METADATA LIST
// This is intentionally small and only retrieves scene metadata.
// It lets us create one independent Export task per scene.
// -----------------------------------------------------------------------------
var sceneCount = s1.size();
var indices = s1.aggregate_array('system:index').getInfo();
var times = s1.aggregate_array('system:time_start').getInfo();
var passes = s1.aggregate_array('orbitProperties_pass').getInfo();

print('A09 V115 STATIC HISTORY EXPORT');
print('Scene count:', sceneCount);
print('Scene indices:', indices);
print('History period:', CONFIG.startDate, 'to', CONFIG.endExclusive);
print('Relative orbit:', CONFIG.relativeOrbit);
print('No temporal features are computed in GEE.');
print('Run ONE raster task at a time.');

var manifestFeatures = [];

for (var i = 0; i < indices.length; i++) {
  var idx = indices[i];
  var sceneNo = i + 1;
  var tag = ('00' + sceneNo).slice(-2);

  var im = ee.Image(
    s1.filter(ee.Filter.eq('system:index', idx)).first()
  );

  var stack = static50(im);
  var t = ee.Date(times[i]);

  manifestFeatures.push(
    ee.Feature(null, {
      sequence: sceneNo,
      tag: 'H' + tag,
      system_index: idx,
      acquisition_utc: t.format(
        'YYYY-MM-dd HH:mm:ss', 'UTC'
      ),
      acquisition_wib: t.advance(7, 'hour').format(
        'YYYY-MM-dd HH:mm:ss', 'Asia/Jakarta'
      ),
      relative_orbit: CONFIG.relativeOrbit,
      orbit_pass: passes[i],
      tile_id: TILE.id,
      support_radius_m: CONFIG.supportRadiusM,
      export_scale_m: CONFIG.exportScaleM,
      output_version: CONFIG.version
    })
  );

  Export.image.toDrive({
    image: stack.toFloat(),
    description:
      'A09_V115_H' + tag + '_ORB120_STATIC_S1_50M_T05NC',
    folder: CONFIG.driveFolder,
    fileNamePrefix:
      'A09_V115_H' + tag + '_ORB120_STATIC_S1_50M_T05NC',
    region: tileGeom,
    crs: CONFIG.exportCrs,
    scale: CONFIG.exportScaleM,
    maxPixels: CONFIG.maxPixels,
    fileFormat: 'GeoTIFF'
  });
}

Export.table.toDrive({
  collection: ee.FeatureCollection(manifestFeatures),
  description: 'A09_V115_S1_HISTORY_MANIFEST',
  folder: CONFIG.driveFolder,
  fileNamePrefix: 'A09_V115_S1_HISTORY_MANIFEST',
  fileFormat: 'CSV'
});

Map.centerObject(tileGeom, 8);
Map.addLayer(tileGeom, {color:'blue'}, 'T05_NC');
