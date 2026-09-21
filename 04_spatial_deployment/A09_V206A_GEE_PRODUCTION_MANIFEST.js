/*
A09 V206A — FULL-AOI PRODUCTION MANIFEST
========================================
Metadata only. NO GWL raster export.

Purpose:
Inventory every Sentinel-1A scene × tile pair required for
WET and DRY full-AOI production.
*/

var CONFIG = {
  aoiAsset: 'projects/ee-adsgeophysics/assets/KHG_SUMSEL',
  s1Collection: 'COPERNICUS/S1_GRD',
  driveFolder: 'Penelitian2026',

  outputVersion: 'A09_V206A',

  wibOffsetHours: 7,

  validatedOrbits: [
    18,
    98,
    120,
    171
  ]
};


// ============================================================================
// PRODUCTION WINDOWS
// ============================================================================
//
// WIB intervals are converted explicitly to UTC.
// This prevents recurrence of the previous double-timezone problem.
//
// WET WIB:
// 2019-04-01 00:00 to 2019-04-13 00:00 exclusive
//
// DRY WIB:
// 2019-11-13 00:00 to 2019-11-25 00:00 exclusive
// ============================================================================

var WINDOWS = [

  {
    order: 1,

    id:
      'WET_20190401_20190413',

    label:
      'Representative wetter-condition production window',

    startWib:
      '2019-04-01',

    endExclusiveWib:
      '2019-04-13',

    startUtc:
      '2019-03-31T17:00:00',

    endExclusiveUtc:
      '2019-04-12T17:00:00',

    fieldMatchedN:
      15,

    fieldStations:
      7,

    fieldMedianGwlM:
      0.284
  },

  {
    order: 2,

    id:
      'DRY_20191113_20191125',

    label:
      'Representative drier-condition production window',

    startWib:
      '2019-11-13',

    endExclusiveWib:
      '2019-11-25',

    startUtc:
      '2019-11-12T17:00:00',

    endExclusiveUtc:
      '2019-11-24T17:00:00',

    fieldMatchedN:
      15,

    fieldStations:
      7,

    fieldMedianGwlM:
      -0.910
  }

];


// ============================================================================
// FULL-AOI TILE GRID
// ============================================================================

var TILES = [

  {
    order: 1,
    id: 'T01_SW',
    rect: [
      102.5,
      -4.8,
      103.833333,
      -3.15
    ]
  },

  {
    order: 2,
    id: 'T02_SC',
    rect: [
      103.833333,
      -4.8,
      105.166667,
      -3.15
    ]
  },

  {
    order: 3,
    id: 'T03_SE',
    rect: [
      105.166667,
      -4.8,
      106.5,
      -3.15
    ]
  },

  {
    order: 4,
    id: 'T04_NW',
    rect: [
      102.5,
      -3.15,
      103.833333,
      -1.5
    ]
  },

  {
    order: 5,
    id: 'T05_NC',
    rect: [
      103.833333,
      -3.15,
      105.166667,
      -1.5
    ]
  },

  {
    order: 6,
    id: 'T06_NE',
    rect: [
      105.166667,
      -3.15,
      106.5,
      -1.5
    ]
  }

];


// ============================================================================
// AOI
// ============================================================================

var aoiFc =
  ee.FeatureCollection(
    CONFIG.aoiAsset
  );

var aoi =
  aoiFc.geometry();


// ============================================================================
// SENTINEL-1 DOMAIN
// ============================================================================
//
// EXACT model deployment domain:
//
// Sentinel-1A only
// IW
// VV + VH
// 10 m GRD
// validated relative orbits only
// ============================================================================

var s1Base =
  ee.ImageCollection(
    CONFIG.s1Collection
  )

  .filterBounds(
    aoi
  )

  .filter(
    ee.Filter.eq(
      'instrumentMode',
      'IW'
    )
  )

  .filter(
    ee.Filter.eq(
      'resolution_meters',
      10
    )
  )

  .filter(
    ee.Filter.listContains(
      'transmitterReceiverPolarisation',
      'VV'
    )
  )

  .filter(
    ee.Filter.listContains(
      'transmitterReceiverPolarisation',
      'VH'
    )
  )

  .filter(
    ee.Filter.eq(
      'platform_number',
      'A'
    )
  )

  .filter(
    ee.Filter.inList(
      'relativeOrbitNumber_start',
      CONFIG.validatedOrbits
    )
  );


// ============================================================================
// HELPERS
// ============================================================================

function makeTileGeometry(tile) {

  return ee.Geometry.Rectangle(

    tile.rect,

    'EPSG:4326',

    false
  );

}


function acquisitionWib(img) {

  var utc =
    ee.Date(
      img.get(
        'system:time_start'
      )
    );

  // Correct rule:
  // UTC + 7 hours ONCE,
  // then format as UTC to avoid timezone conversion #2.

  return utc

    .advance(
      CONFIG.wibOffsetHours,
      'hour'
    )

    .format(
      'YYYY-MM-dd HH:mm:ss',
      'UTC'
    );

}


function acquisitionWibDate(img) {

  var utc =
    ee.Date(
      img.get(
        'system:time_start'
      )
    );

  return utc

    .advance(
      CONFIG.wibOffsetHours,
      'hour'
    )

    .format(
      'YYYY-MM-dd',
      'UTC'
    );

}


// ============================================================================
// MANIFEST
// ============================================================================

var manifest =
  ee.FeatureCollection([]);

var tileWindowSummary =
  [];


// Iterate client-side only across:
// 2 windows × 6 fixed tiles.
//
// Sentinel-1 processing remains server-side.

WINDOWS.forEach(
  function(w) {

    var scenesWindow =
      s1Base

      .filterDate(

        ee.Date(
          w.startUtc
        ),

        ee.Date(
          w.endExclusiveUtc
        )

      )

      .sort(
        'system:time_start'
      );


    TILES.forEach(
      function(tile) {

        var tileGeom =
          makeTileGeometry(
            tile
          );

        // Only actual KHG area inside this tile.

        var tileKhg =
          tileGeom.intersection(

            aoi,

            ee.ErrorMargin(
              30
            )

          );


        var tileKhgArea =
          tileKhg.area(
            30
          );


        // Scene must overlap actual KHG inside this tile.

        var scenes =
          scenesWindow

          .filterBounds(
            tileKhg
          )

          .sort(
            'system:time_start'
          );


        var part =
          scenes.map(
            function(img) {

              img =
                ee.Image(img);


              var utc =
                ee.Date(
                  img.get(
                    'system:time_start'
                  )
                );


              var sceneGeom =
                img.geometry();


              var overlap =
                sceneGeom.intersection(

                  tileKhg,

                  ee.ErrorMargin(
                    30
                  )

                );


              var overlapArea =
                overlap.area(
                  30
                );


              var overlapFraction =
                ee.Number(

                  ee.Algorithms.If(

                    tileKhgArea.gt(0),

                    overlapArea.divide(
                      tileKhgArea
                    ),

                    0
                  )
                );


              var systemIndex =
                ee.String(
                  img.get(
                    'system:index'
                  )
                );


              var orbit =
                ee.Number(
                  img.get(
                    'relativeOrbitNumber_start'
                  )
                );


              var pass =
                ee.String(
                  img.get(
                    'orbitProperties_pass'
                  )
                );


              var plannedName =

                ee.String(
                  'A09_V206B_GWL50M_'
                )

                .cat(
                  w.id
                )

                .cat(
                  '_'
                )

                .cat(
                  tile.id
                )

                .cat(
                  '_'
                )

                .cat(
                  systemIndex
                );


              return ee.Feature(
                null,
                {

                  output_version:
                    CONFIG.outputVersion,


                  // --------------------------------------------
                  // WINDOW
                  // --------------------------------------------

                  window_order:
                    w.order,

                  window_id:
                    w.id,

                  window_label:
                    w.label,

                  window_start_wib:
                    w.startWib,

                  window_end_exclusive_wib:
                    w.endExclusiveWib,

                  window_start_utc:
                    w.startUtc,

                  window_end_exclusive_utc:
                    w.endExclusiveUtc,

                  field_reference_n:
                    w.fieldMatchedN,

                  field_reference_stations:
                    w.fieldStations,

                  field_reference_median_gwl_m:
                    w.fieldMedianGwlM,


                  // --------------------------------------------
                  // TILE
                  // --------------------------------------------

                  tile_order:
                    tile.order,

                  tile_id:
                    tile.id,

                  tile_west:
                    tile.rect[0],

                  tile_south:
                    tile.rect[1],

                  tile_east:
                    tile.rect[2],

                  tile_north:
                    tile.rect[3],

                  tile_khg_area_m2:
                    tileKhgArea,


                  // --------------------------------------------
                  // SENTINEL-1
                  // --------------------------------------------

                  s1_system_index:
                    systemIndex,

                  s1_image_id:
                    img.id(),

                  acquisition_millis_utc:
                    utc.millis(),

                  acquisition_utc:
                    utc.format(
                      'YYYY-MM-dd HH:mm:ss',
                      'UTC'
                    ),

                  acquisition_wib_corrected:
                    acquisitionWib(
                      img
                    ),

                  acquisition_date_wib:
                    acquisitionWibDate(
                      img
                    ),

                  relative_orbit:
                    orbit,

                  orbit_pass:
                    pass,

                  platform_number:
                    img.get(
                      'platform_number'
                    ),

                  instrument_mode:
                    img.get(
                      'instrumentMode'
                    ),

                  resolution_meters:
                    img.get(
                      'resolution_meters'
                    ),


                  // --------------------------------------------
                  // SCENE × TILE
                  // --------------------------------------------

                  scene_tile_khg_overlap_m2:
                    overlapArea,

                  scene_tile_khg_overlap_fraction:
                    overlapFraction,


                  // --------------------------------------------
                  // PLANNED V206B
                  // --------------------------------------------

                  planned_export_name:
                    plannedName,

                  planned_support_m:
                    50,

                  planned_primary_m:
                    1000,

                  planned_inference:
                    'GEE native frozen Ridge V102',

                  planned_postprocess:
                    'offline 1km aggregation + scene median + tile mosaic + exact AOI mask',

                  smap_peat_dtw_used:
                    0

                }
              );

            }
          );


        manifest =
          manifest.merge(
            ee.FeatureCollection(
              part
            )
          );


        // =====================================================
        // TILE × WINDOW SUMMARY
        // =====================================================

        tileWindowSummary.push(

          ee.Feature(
            null,
            {

              output_version:
                CONFIG.outputVersion,

              window_order:
                w.order,

              window_id:
                w.id,

              tile_order:
                tile.order,

              tile_id:
                tile.id,

              tile_khg_area_m2:
                tileKhgArea,

              s1_scene_count:
                scenes.size(),

              relative_orbits:

                scenes

                .aggregate_array(
                  'relativeOrbitNumber_start'
                )

                .distinct()

                .sort(),

              orbit_passes:

                scenes

                .aggregate_array(
                  'orbitProperties_pass'
                )

                .distinct()

                .sort(),

              field_reference_n:
                w.fieldMatchedN,

              field_reference_stations:
                w.fieldStations,

              field_reference_median_gwl_m:
                w.fieldMedianGwlM

            }
          )

        );

      }
    );

  }
);


// ============================================================================
// WINDOW SUMMARY
// ============================================================================

var windowSummary =
  ee.FeatureCollection(

    WINDOWS.map(
      function(w) {

        var scenes =

          s1Base

          .filterDate(

            ee.Date(
              w.startUtc
            ),

            ee.Date(
              w.endExclusiveUtc
            )

          )

          .sort(
            'system:time_start'
          );


        return ee.Feature(
          null,
          {

            output_version:
              CONFIG.outputVersion,

            window_order:
              w.order,

            window_id:
              w.id,

            start_wib:
              w.startWib,

            end_exclusive_wib:
              w.endExclusiveWib,

            start_utc:
              w.startUtc,

            end_exclusive_utc:
              w.endExclusiveUtc,

            unique_s1_scene_count:
              scenes.size(),

            relative_orbits:

              scenes

              .aggregate_array(
                'relativeOrbitNumber_start'
              )

              .distinct()

              .sort(),

            orbit_passes:

              scenes

              .aggregate_array(
                'orbitProperties_pass'
              )

              .distinct()

              .sort(),

            field_reference_n:
              w.fieldMatchedN,

            field_reference_stations:
              w.fieldStations,

            field_reference_median_gwl_m:
              w.fieldMedianGwlM

          }
        );

      }
    )
  );


// ============================================================================
// EXPORT — METADATA ONLY
// ============================================================================

Export.table.toDrive({

  collection:
    manifest,

  description:
    'A09_V206A_PRODUCTION_MANIFEST',

  folder:
    CONFIG.driveFolder,

  fileNamePrefix:
    'A09_V206A_PRODUCTION_MANIFEST',

  fileFormat:
    'CSV'

});


Export.table.toDrive({

  collection:
    ee.FeatureCollection(
      tileWindowSummary
    ),

  description:
    'A09_V206A_TILE_WINDOW_SUMMARY',

  folder:
    CONFIG.driveFolder,

  fileNamePrefix:
    'A09_V206A_TILE_WINDOW_SUMMARY',

  fileFormat:
    'CSV'

});


Export.table.toDrive({

  collection:
    windowSummary,

  description:
    'A09_V206A_WINDOW_SUMMARY',

  folder:
    CONFIG.driveFolder,

  fileNamePrefix:
    'A09_V206A_WINDOW_SUMMARY',

  fileFormat:
    'CSV'

});


// ============================================================================
// CONSOLE QA
// ============================================================================

print(
  'A09 V206A — FULL-AOI PRODUCTION MANIFEST'
);

print(
  'NO raster export exists in V206A.'
);

print(
  'Validated Sentinel-1A relative orbits:',
  CONFIG.validatedOrbits
);

print(
  'Manifest rows = scene × tile pairs intersecting KHG.'
);

print(
  'Manifest row count:',
  manifest.size()
);

print(
  'Manifest preview:',
  manifest.limit(
    20
  )
);

print(
  'Tile-window summary:',
  ee.FeatureCollection(
    tileWindowSummary
  )
);

print(
  'Window summary:',
  windowSummary
);

print(
  'Run all THREE CSV tasks.'
);


// ============================================================================
// MAP — LIGHTWEIGHT ONLY
// ============================================================================

Map.centerObject(
  aoiFc,
  7
);


Map.addLayer(

  aoiFc.style({
    color:
      '000000',

    fillColor:
      '00000000'
  }),

  {},

  'KHG_SUMSEL'

);


TILES.forEach(
  function(tile) {

    Map.addLayer(

      makeTileGeometry(
        tile
      ),

      {
        color:
          '777777'
      },

      tile.id,

      false

    );

  }
);