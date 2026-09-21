/*
A09 V206B — FULL-AOI GEE-NATIVE FROZEN RIDGE PRODUCTION
Scientific model: A08_FINAL_GWL_RIDGE_V102
Purpose: batch production of 50-m model-support GWL rasters only.
V204 exact algebra parity and V205 50-m memory gate already passed.
Primary 1-km aggregation/mosaicking is performed offline after inference.
*/

/*
A-09 | Spatial Deployment Gate for Final Peat GWL Model
Version: V110 PIXELWISE TEMPORAL PARITY
Project: Integrated Peat Hydrology & Weekly Fire Forecasting — South Sumatra

SCIENTIFIC ROLE
---------------
A-09 applies the frozen A-08 field-validated GWL model spatially.

Frozen model:
  Ridge(alpha = 10.0)
  GPM antecedent through WIB day t-1
  + SMAP L4 V8 hydrological state (NO SMAP peat-DTW predictor)
  + Sentinel-1A 50 m support + past-only same-orbit temporal features

PRIMARY OUTPUT
--------------
Memory-safe 12-day synoptic GWL prediction surfaces for two pilot windows:
  WET pilot: 2019-04-01 to 2019-04-13 WIB
  DRY pilot: 2019-11-13 to 2019-11-25 WIB

The model is evaluated scene-by-scene at Sentinel-1 acquisition times.
The 12-day product is the median of scene-level predictions after each scene is aggregated to 1 km.

IMPORTANT RESOLUTION RULE
-------------------------
The fitted Sentinel-1 support is 50 m, but GPM and SMAP are coarse predictors.
Therefore:
  - 50 m output = model-support/downscaled inference (sensitivity/visualization)
  - 1 km output = PRIMARY SCIENTIFIC MAP for A-09/Paper A
Do NOT describe the product as physically measured 50 m groundwater level.

Generated from the exact frozen sklearn pipeline.
Local algebra parity check: max absolute difference = 0.0 m over 1,131 model rows.
*/

var CONFIG = {
  aoiAsset: 'projects/ee-adsgeophysics/assets/KHG_SUMSEL',
  s1Collection: 'COPERNICUS/S1_GRD',
  gpmCollection: 'NASA/GPM_L3/IMERG_V07',
  smapCollection: 'NASA/SMAP/SPL4SMGP/008',

  driveFolder: 'Penelitian2026',
  outputVersion: 'A09_V206B_GEE_RIDGE_PRODUCTION',

  wibOffsetHours: 7,
  s1SupportM: 50,
  gpmBufferM: 10000,
  gpmNativeScaleM: 11132,
  gpmHalfHourToHours: 0.5,
  expectedGpmStepsPerDay: 48,
  smapSearchHours: 3,

  // Start conservatively: export 1 km + QA first.
  export1km: true,
  export50m: false,
  exportQaTable: true,

  exportCrs: 'EPSG:32748',
  scale1km: 1000,
  scale50m: 50,
  maxPixels: 1e10,

  validatedMacroRmseM: 0.2956359,
  validatedPooledRmseM: 0.3170121,
  validatedPooledR2: 0.4610673
};

var PILOT_WINDOWS = [
  {
    id: 'WET_20190401_20190413',
    startWib: '2019-04-01',
    endExclusiveWib: '2019-04-13',
    fieldMatchedN: 15,
    fieldStations: 7,
    fieldMedianGwlM: 0.284,
    label: 'Representative wetter-condition pilot'
  },
  {
    id: 'DRY_20191113_20191125',
    startWib: '2019-11-13',
    endExclusiveWib: '2019-11-25',
    fieldMatchedN: 15,
    fieldStations: 7,
    fieldMedianGwlM: -0.910,
    label: 'Representative drier-condition pilot'
  }
];


// -----------------------------------------------------------------------------
// V104 DIAGNOSTIC TILE
// Small central tile, one orbit per task.
// -----------------------------------------------------------------------------
var TILE_BUFFER_M = 12000;

var DIAGNOSTIC_TILE = {
  id: 'R3C4',
  rect: [104.5, -3.15, 105.166667, -2.325]
};

var DIAGNOSTIC_WINDOW = {
  id: 'WET_20190401_20190413',
  startWib: '2019-04-01',
  endExclusiveWib: '2019-04-13',
  fieldMatchedN: 15,
  fieldStations: 7,
  fieldMedianGwlM: 0.284,
  label: 'Representative wetter-condition diagnostic'
};

var VALIDATED_ORBITS = [18, 98, 120, 171];

// -----------------------------------------------------------------------------
// Frozen GPM two-stage calibration (31 July 2026)
// -----------------------------------------------------------------------------
var GPM_WET_THRESHOLD_MM_DAY = 1.0;
var GPM_OCCURRENCE_PROB_THRESHOLD = 0.45;

var GPM_OCCURRENCE = {
  intercept: -1.9989917082970008,
  logGpm: 1.2123245713292512,
  monthSin: 0.29400577301819264,
  monthCos: 0.053979584981986566
};

var GPM_INTENSITY = {
  intercept: 1.2011518444120506,
  logGpm: 0.3650578012586378,
  monthSin: 0.04591849203325665,
  monthCos: -0.005627429916749691
};

// -----------------------------------------------------------------------------
// Exact A-08 V102 corrected-time sklearn deployment parameters
// Auto-extracted from the frozen V102 joblib; do not edit manually.
// -----------------------------------------------------------------------------
// =============================================================
// A08 V102 CORRECTED-TIME FROZEN RIDGE — AUTO-EXTRACTED
// DO NOT EDIT THESE VALUES MANUALLY.
// Source: A08_FINAL_GWL_RIDGE_V102.joblib
// =============================================================
var NUMERIC_NAMES = ["gpm_calibrated_accum_1d_mm","gpm_calibrated_accum_3d_mm","gpm_calibrated_accum_7d_mm","gpm_calibrated_accum_14d_mm","gpm_calibrated_accum_30d_mm","gpm_dry_streak_days","gpm_wet_days_7d","gpm_wet_days_14d","gpm_wet_days_30d","doy_sin","doy_cos","smap_sm_surface","smap_sm_rootzone","smap_sm_profile","smap_surface_wetness","smap_rootzone_wetness","smap_profile_wetness","smap_land_fraction_saturated","smap_surface_temp_K","smap_vegetation_greenness_fraction","smap_leaf_area_index","vv_median_50m_db","vh_median_50m_db","vv_minus_vh_50m_db","vh_vv_ratio_linear_50m","rvi_50m","angle_median_50m_deg","days_since_prev_same_orbit_50m","delta_vv_prev_same_orbit_50m_db","delta_vh_prev_same_orbit_50m_db","delta_vvdiff_prev_same_orbit_50m_db","vv_anom_prev3_same_orbit_50m_db","vh_anom_prev3_same_orbit_50m_db","n_prev3_history_50m"];
var NUMERIC_MEDIANS = [0.0,9.719708607896443,23.44480604670259,47.17409933554181,108.77513998124545,1.0,3.0,7.0,15.0,-0.1754125938042784,0.4373400963303323,0.6675770282745361,0.896864116191864,0.9229154586791992,0.7177700400352478,0.9644206762313844,0.992357075214386,0.1634521484375,299.2142944335937,0.9417136311531068,3.42871642112732,-9.14225672006907,-15.442193717698302,6.253799045556298,0.2369300223747034,0.7661873124231765,39.328948974609375,12.0,1.3859803861950004e-05,0.010971913112971451,-0.01783514018781315,0.0019181676945211998,0.0037675013036793,3.0];
var SCALE_MEANS = [3.5144091155046433,10.268931124405837,24.149068916293306,48.343120927059914,103.33945962706586,3.0097087378640777,3.1968225948808473,6.3945278022947925,13.712268314210062,-0.14664040478555324,0.37420106658658503,0.6161551023689604,0.847294304713883,0.9118518292746077,0.6625314928255877,0.9110624658146056,0.9804852464929262,0.17892225492668168,298.56001188811854,0.939240293437574,3.3670913630213657,-10.442141328298746,-16.750502457030905,6.308361128732157,0.24671149668971257,0.7781558152886626,39.447743611546656,14.160637656908897,0.019321093056484807,0.016909561935413632,0.0023690424995787334,-0.0021074223087723318,0.0014488777593386715,2.9549867608120035,0.649602824360106,0.649602824360106,0.00617828773168579,0.00617828773168579,0.00617828773168579,0.00617828773168579,0.00617828773168579,0.00617828773168579];
var SCALE_SCALES = [4.092360912436683,8.393279139640152,16.220401414725647,27.59339018208532,51.83118148077048,6.230557983331597,1.9829610819560066,3.4324455310123256,6.522836486194057,0.4114233248801622,0.40476332494274186,0.1763913913784242,0.10482861605209427,0.02419052016784525,0.18967245788860476,0.112720288337163,0.026005689194027282,0.15519986444227224,2.1924856921333147,0.02386651749340419,0.673486633952639,3.718300852335086,3.5311176376371476,1.4195341519341935,0.08376942129842212,0.20133769317719974,3.919310999696642,13.785615790627089,1.6565986184616928,1.498074331962902,1.4617580549936957,1.638777350083444,1.413014756325462,0.30688527889992206,0.4770943249960948,0.4770943249960948,0.07835889542604778,0.07835889542604778,0.07835889542604778,0.07835889542604778,0.07835889542604778,0.07835889542604778];
var RIDGE_COEFS = [0.012415119713555335,0.00117290250811967,0.09777210871253907,0.02488642792791733,0.014057832598760237,-2.606890668220818e-05,-0.054252167687019154,-0.02768376160610123,0.02410203083560541,-0.005282685430610076,-0.010776677304702493,-0.026598284025305473,0.07962093802896265,0.03008677977667234,-0.02634260051218466,0.07926263772733295,0.02717553767792035,0.0417142518630755,0.02328595121572665,0.042769845499993714,-0.0697940763426999,-0.09527075699034956,-0.08927634637507698,-0.027473841018827164,0.022706300818590295,-0.004414030968512884,0.07023298740640796,0.004462810431220146,0.01665653006447999,0.012948028955492272,0.005607826250403139,0.03642682719611248,-0.014687139786561124,-0.04760701645756113,0.003263141276859366,0.0032631412768593247,-0.0022460009618839724,-0.002246000961884003,-0.0022460009618840144,-0.0022460009618840283,-0.002246000961884014,-0.0022460009618840092,0.020629708819287534,-0.020629708819287575,0.04582548003716868,-0.13249047391219257,-0.06645518885643534,0.15312018273145817];
var MISSING_INDICATOR_NUMERIC_INDICES = [9,10,27,28,29,30,31,32];
var RIDGE_INTERCEPT = -0.15831850433420505;
var CAT_COEF_INDEX = {"passAscending":42,"passDescending":43,"orbit120":44,"orbit171":45,"orbit18":46,"orbit98":47};

// Audit metadata only:
var A08_V102_RIDGE_ALPHA = 10.0;
var A08_V102_CAT_CATEGORIES = {"orbit_pass":["ASCENDING","DESCENDING"],"relative_orbit_start":["120","171","18","98"]};

// -----------------------------------------------------------------------------
// Collections
// -----------------------------------------------------------------------------
var aoiFc = ee.FeatureCollection(CONFIG.aoiAsset);
var aoi = aoiFc.geometry();

var s1 = ee.ImageCollection(CONFIG.s1Collection)
  .filterBounds(aoi)
  .filter(ee.Filter.eq('instrumentMode', 'IW'))
  .filter(ee.Filter.eq('resolution_meters', 10))
  .filter(ee.Filter.listContains('transmitterReceiverPolarisation', 'VV'))
  .filter(ee.Filter.listContains('transmitterReceiverPolarisation', 'VH'))
  // Training rows were Sentinel-1A; retain the same platform domain.
  .filter(ee.Filter.eq('platform_number', 'A'))
  .filter(ee.Filter.inList('relativeOrbitNumber_start', [18, 98, 120, 171]));

var gpm = ee.ImageCollection(CONFIG.gpmCollection)
  .select('precipitation')
  .filter(ee.Filter.eq('status', 'permanent'));

var smap = ee.ImageCollection(CONFIG.smapCollection);

// -----------------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------------
function emptyImage(names) {
  return ee.Image.constant(ee.List.repeat(0, names.length))
    .rename(names)
    .updateMask(ee.Image.constant(0));
}

function dayStartWibFromS1(image) {
  var shifted = ee.Date(image.get('system:time_start'))
    .advance(CONFIG.wibOffsetHours, 'hour');
  return ee.Date(shifted.format('YYYY-MM-dd'));
}

function focal50(image, workGeom) {
  image = ee.Image(image).clip(workGeom);
  var vv = image.select('VV')
    .focal_median({radius: CONFIG.s1SupportM, units: 'meters', kernelType: 'circle'})
    .rename('vv_median_50m_db');
  var vh = image.select('VH')
    .focal_median({radius: CONFIG.s1SupportM, units: 'meters', kernelType: 'circle'})
    .rename('vh_median_50m_db');
  var angle = image.select('angle')
    .focal_median({radius: CONFIG.s1SupportM, units: 'meters', kernelType: 'circle'})
    .rename('angle_median_50m_deg');

  var diff = vv.subtract(vh).rename('vv_minus_vh_50m_db');
  var vvLin = ee.Image.constant(10).pow(vv.divide(10));
  var vhLin = ee.Image.constant(10).pow(vh.divide(10));
  var ratio = vhLin.divide(vvLin).rename('vh_vv_ratio_linear_50m');
  var rvi = vhLin.multiply(4).divide(vvLin.add(vhLin)).rename('rvi_50m');

  return vv.addBands(vh)
    .addBands(diff)
    .addBands(ratio)
    .addBands(rvi)
    .addBands(angle);
}

function s1TemporalFeatures(current, workGeom) {
  current = ee.Image(current);

  var t = ee.Date(current.get('system:time_start'));
  var orbit = ee.Number(current.get('relativeOrbitNumber_start'));
  var pass = ee.String(current.get('orbitProperties_pass'));

  var cur = focal50(current, workGeom);
  var curMask = cur.select('vv_median_50m_db').mask();

  // ---------------------------------------------------------------------------
  // V110 CRITICAL FIX:
  // A08 temporal features were constructed station-by-station. Therefore the
  // "previous" observation is the most recent SAME-ORBIT image that is valid
  // at that specific station/pixel, not simply the globally previous granule.
  //
  // We reproduce that spatially using a time band + qualityMosaic, which picks
  // the most recent valid observation independently for every pixel.
  // ---------------------------------------------------------------------------

  var historyRaw = s1
    .filter(ee.Filter.eq('relativeOrbitNumber_start', orbit))
    .filter(ee.Filter.eq('orbitProperties_pass', pass))
    .filterDate('2019-01-01', t)
    .filterBounds(workGeom);

  var history = historyRaw.map(function(im) {
    im = ee.Image(im);
    var f = focal50(im, workGeom)
      .select([
        'vv_median_50m_db',
        'vh_median_50m_db'
      ]);

    var valid = f.select('vv_median_50m_db').mask();

    var timeBand = ee.Image.constant(
        ee.Number(im.get('system:time_start'))
      )
      .rename('history_time_ms')
      .toDouble()
      .updateMask(valid);

    return f.addBands(timeBand);
  });

  // Fully masked fallback image with the correct bands.
  var emptyHist = ee.Image.constant([0, 0, 0])
    .rename([
      'vv_median_50m_db',
      'vh_median_50m_db',
      'history_time_ms'
    ])
    .updateMask(ee.Image.constant(0))
    .clip(workGeom);

  // Most recent valid previous observation at each pixel.
  var prev1 = ee.Image(ee.Algorithms.If(
    history.size().gt(0),
    history.qualityMosaic('history_time_ms'),
    emptyHist
  ));

  var prev1Time = prev1.select('history_time_ms');
  var prev1Valid = prev1.select('vv_median_50m_db').mask();

  // Second-most-recent valid observation, pixel by pixel.
  var history2 = history.map(function(im) {
    im = ee.Image(im);
    return im.updateMask(
      im.select('history_time_ms').lt(prev1Time)
    );
  });

  var prev2 = ee.Image(ee.Algorithms.If(
    history2.size().gt(0),
    history2.qualityMosaic('history_time_ms'),
    emptyHist
  ));

  var prev2Time = prev2.select('history_time_ms');

  // Third-most-recent valid observation, pixel by pixel.
  var history3 = history2.map(function(im) {
    im = ee.Image(im);
    return im.updateMask(
      im.select('history_time_ms').lt(prev2Time)
    );
  });

  var prev3 = ee.Image(ee.Algorithms.If(
    history3.size().gt(0),
    history3.qualityMosaic('history_time_ms'),
    emptyHist
  ));

  var prevStack = ee.ImageCollection.fromImages([
    prev1.select(['vv_median_50m_db','vh_median_50m_db']),
    prev2.select(['vv_median_50m_db','vh_median_50m_db']),
    prev3.select(['vv_median_50m_db','vh_median_50m_db'])
  ]);

  var prevMean = prevStack.mean();

  var nPrev = prevStack
    .select('vv_median_50m_db')
    .count()
    .min(3)
    .rename('n_prev3_history_50m')
    .updateMask(curMask);

  var currentTime = ee.Image.constant(t.millis()).toDouble();

  var daysSince = currentTime
    .subtract(prev1Time)
    .divide(1000 * 60 * 60 * 24)
    .rename('days_since_prev_same_orbit_50m')
    .updateMask(prev1Valid)
    .updateMask(curMask);

  var dVV = cur.select('vv_median_50m_db')
    .subtract(prev1.select('vv_median_50m_db'))
    .rename('delta_vv_prev_same_orbit_50m_db');

  var dVH = cur.select('vh_median_50m_db')
    .subtract(prev1.select('vh_median_50m_db'))
    .rename('delta_vh_prev_same_orbit_50m_db');

  var dDiff = cur.select('vv_minus_vh_50m_db')
    .subtract(
      prev1.select('vv_median_50m_db')
        .subtract(prev1.select('vh_median_50m_db'))
    )
    .rename('delta_vvdiff_prev_same_orbit_50m_db');

  var vvAnom = cur.select('vv_median_50m_db')
    .subtract(prevMean.select('vv_median_50m_db'))
    .rename('vv_anom_prev3_same_orbit_50m_db');

  var vhAnom = cur.select('vh_median_50m_db')
    .subtract(prevMean.select('vh_median_50m_db'))
    .rename('vh_anom_prev3_same_orbit_50m_db');

  return cur
    .addBands(daysSince)
    .addBands(dVV)
    .addBands(dVH)
    .addBands(dDiff)
    .addBands(vvAnom)
    .addBands(vhAnom)
    .addBands(nPrev);
}

// -----------------------------------------------------------------------------
// GPM daily calibrated spatial field — V101 MEMORY-SAFE
// Daily calibrated GPM images are constructed ONCE per 12-day window.
// -----------------------------------------------------------------------------
function gpmDailyCalibrated(dateWibInput, workGeom) {
  var dateWib = ee.Date(dateWibInput);
  var utcStart = dateWib.advance(-CONFIG.wibOffsetHours, 'hour');
  var utcEnd = utcStart.advance(1, 'day');

  var halfHourly = gpm.filterDate(utcStart, utcEnd);
  var validSteps = halfHourly.count();

  var daily = halfHourly.map(function(im) {
      return im.multiply(CONFIG.gpmHalfHourToHours);
    })
    .sum()
    .updateMask(validSteps.eq(CONFIG.expectedGpmStepsPerDay))
    .rename('gpm_daily_mm_qc');

  // V104: force GPM neighborhood processing on the native coarse grid.
  var nativeProj = ee.Image(halfHourly.first()).projection();
  var dailyNative = daily.reproject({
    crs: nativeProj,
    scale: CONFIG.gpmNativeScaleM
  });

  var bufferMean = dailyNative.reduceNeighborhood({
    reducer: ee.Reducer.mean(),
    kernel: ee.Kernel.circle({
      radius: CONFIG.gpmBufferM,
      units: 'meters',
      normalize: false
    }),
    skipMasked: true
  })
  .reproject({
    crs: nativeProj,
    scale: CONFIG.gpmNativeScaleM
  })
  .rename('gpm_buffer10km_mm_qc');

  var gpmSafe = bufferMean.max(0);
  var month = ee.Number(dateWib.get('month'));
  var angle = month.multiply(2 * Math.PI / 12);
  var monthSin = angle.sin();
  var monthCos = angle.cos();
  var logGpm = gpmSafe.add(1).log();

  var logit = logGpm.multiply(GPM_OCCURRENCE.logGpm)
    .add(ee.Image.constant(monthSin.multiply(GPM_OCCURRENCE.monthSin)))
    .add(ee.Image.constant(monthCos.multiply(GPM_OCCURRENCE.monthCos)))
    .add(GPM_OCCURRENCE.intercept);

  var wetProbability = ee.Image.constant(1)
    .divide(ee.Image.constant(1).add(logit.multiply(-1).exp()));
  var wetFlag = wetProbability.gte(GPM_OCCURRENCE_PROB_THRESHOLD);

  var logPositive = logGpm.multiply(GPM_INTENSITY.logGpm)
    .add(ee.Image.constant(monthSin.multiply(GPM_INTENSITY.monthSin)))
    .add(ee.Image.constant(monthCos.multiply(GPM_INTENSITY.monthCos)))
    .add(GPM_INTENSITY.intercept);

  var positiveRain = logPositive.exp()
    .subtract(1)
    .max(GPM_WET_THRESHOLD_MM_DAY);

  var calibrated = positiveRain.where(wetFlag.not(), 0)
    .rename('gpm_calibrated_mm_day');

  return calibrated
    .addBands(wetFlag.toByte().rename('wet_flag'))
    .set('system:time_start', dateWib.millis())
    .set('date_wib', dateWib.format('YYYY-MM-dd'))
    .clip(workGeom);
}

function buildDailyGpmCollection(windowStartWib, windowEndExclusiveWib, workGeom) {
  var start = ee.Date(windowStartWib).advance(-30, 'day');
  // Last required daily GPM day is endExclusive - 2 days.
  // Using endExclusive - 1 day as exclusive collection end covers it.
  var endExclusive = ee.Date(windowEndExclusiveWib).advance(-1, 'day');
  var nDays = endExclusive.difference(start, 'day');

  var images = ee.List.sequence(0, nDays.subtract(1)).map(function(offset) {
    return gpmDailyCalibrated(start.advance(ee.Number(offset), 'day'), workGeom);
  });

  return ee.ImageCollection.fromImages(images);
}

function gpmAntecedentFeatures(currentS1, dailyGpm, workGeom) {
  var s1DayWib = dayStartWibFromS1(currentS1);
  var featureDay = s1DayWib.advance(-1, 'day');

  function subsetDays(n) {
    return dailyGpm.filterDate(
      featureDay.advance(ee.Number(n).subtract(1).multiply(-1), 'day'),
      featureDay.advance(1, 'day')
    );
  }

  function sumRain(n, name) {
    return subsetDays(n)
      .select('gpm_calibrated_mm_day')
      .sum()
      .rename(name);
  }

  function countWet(n, name) {
    return subsetDays(n)
      .select('wet_flag')
      .sum()
      .rename(name);
  }

  // Dry streak ending at t-1, capped at the 30-day antecedent window.
  var reverseDays = ee.List.sequence(0, 29);
  var init = ee.Dictionary({
    streak: ee.Image.constant(0).rename('streak'),
    active: ee.Image.constant(1).rename('active')
  });

  var dryState = ee.Dictionary(reverseDays.iterate(function(offset, stateObj) {
    var d = featureDay.advance(ee.Number(offset).multiply(-1), 'day');
    var im = ee.Image(dailyGpm.filterDate(d, d.advance(1, 'day')).first());
    var state = ee.Dictionary(stateObj);
    var streak = ee.Image(state.get('streak'));
    var active = ee.Image(state.get('active'));
    var isDry = im.select('wet_flag').eq(0);
    var add = active.and(isDry);
    return ee.Dictionary({
      streak: streak.add(add),
      active: active.and(isDry)
    });
  }, init));

  var dryStreak = ee.Image(dryState.get('streak'))
    .rename('gpm_dry_streak_days');

  var doy = ee.Number(s1DayWib.getRelative('day', 'year')).add(1);
  var doyAngle = doy.multiply(2 * Math.PI / 365.25);
  var doySin = ee.Image.constant(doyAngle.sin()).rename('doy_sin');
  var doyCos = ee.Image.constant(doyAngle.cos()).rename('doy_cos');

  return sumRain(1, 'gpm_calibrated_accum_1d_mm')
    .addBands(sumRain(3, 'gpm_calibrated_accum_3d_mm'))
    .addBands(sumRain(7, 'gpm_calibrated_accum_7d_mm'))
    .addBands(sumRain(14, 'gpm_calibrated_accum_14d_mm'))
    .addBands(sumRain(30, 'gpm_calibrated_accum_30d_mm'))
    .addBands(dryStreak)
    .addBands(countWet(7, 'gpm_wet_days_7d'))
    .addBands(countWet(14, 'gpm_wet_days_14d'))
    .addBands(countWet(30, 'gpm_wet_days_30d'))
    .addBands(doySin)
    .addBands(doyCos)
    .clip(workGeom);
}

// -----------------------------------------------------------------------------
// Nearest SMAP L4 state to each Sentinel-1 acquisition
// -----------------------------------------------------------------------------
var SMAP_SOURCE = [
  'sm_surface',
  'sm_rootzone',
  'sm_profile',
  'sm_surface_wetness',
  'sm_rootzone_wetness',
  'sm_profile_wetness',
  'land_fraction_saturated',
  'surface_temp',
  'vegetation_greenness_fraction',
  'leaf_area_index'
];

var SMAP_OUTPUT = [
  'smap_sm_surface',
  'smap_sm_rootzone',
  'smap_sm_profile',
  'smap_surface_wetness',
  'smap_rootzone_wetness',
  'smap_profile_wetness',
  'smap_land_fraction_saturated',
  'smap_surface_temp_K',
  'smap_vegetation_greenness_fraction',
  'smap_leaf_area_index'
];

function nearestSmap(currentS1, workGeom) {
  var t = ee.Date(currentS1.get('system:time_start'));
  var candidates = smap
    .filterDate(
      t.advance(-CONFIG.smapSearchHours, 'hour'),
      t.advance(CONFIG.smapSearchHours, 'hour')
    )
    .map(function(im) {
      var dt = ee.Number(im.get('system:time_start'))
        .subtract(t.millis())
        .abs();
      return im.set('abs_dt_ms', dt);
    })
    .sort('abs_dt_ms');

  var chosen = ee.Image(candidates.first());
  var nativeProj = chosen.select('sm_surface').projection();

  return chosen
    .select(SMAP_SOURCE, SMAP_OUTPUT)
    .reproject({
      crs: nativeProj,
      scale: 11000
    })
    .clip(workGeom);
}

// -----------------------------------------------------------------------------
// Exact frozen Ridge model
// -----------------------------------------------------------------------------
function predictScene(currentS1, dailyGpm, workGeom) {
  currentS1 = ee.Image(currentS1);

  var s1Feat = s1TemporalFeatures(currentS1, workGeom);
  var gpmFeat = gpmAntecedentFeatures(currentS1, dailyGpm, workGeom);
  var smapFeat = nearestSmap(currentS1, workGeom);

  var features = gpmFeat
    .addBands(smapFeat)
    .addBands(s1Feat)
    .select(NUMERIC_NAMES);

  // Anchor all calculations to the fine-scale Sentinel-1 support projection.
  var pred = s1Feat.select('vv_median_50m_db')
    .multiply(0)
    .add(RIDGE_INTERCEPT)
    .rename('gwl_pred_m');

  var missingImages = [];

  // First 34 standardized numeric predictors.
  for (var i = 0; i < NUMERIC_NAMES.length; i++) {
    var raw = features.select(NUMERIC_NAMES[i]);
    var missing = raw.mask().eq(0).unmask(1).rename('miss_' + NUMERIC_NAMES[i]);
    missingImages.push(missing);

    var filled = raw.unmask(NUMERIC_MEDIANS[i]);
    var standardized = filled
      .subtract(SCALE_MEANS[i])
      .divide(SCALE_SCALES[i]);

    pred = pred.add(standardized.multiply(RIDGE_COEFS[i]));
  }

  // Six missing-indicator terms created by the frozen sklearn imputer.
  for (var j = 0; j < MISSING_INDICATOR_NUMERIC_INDICES.length; j++) {
    var sourceIndex = MISSING_INDICATOR_NUMERIC_INDICES[j];
    var indicator = ee.Image(missingImages[sourceIndex]);
    var scaledIndex = NUMERIC_NAMES.length + j;
    var standardizedIndicator = indicator
      .subtract(SCALE_MEANS[scaledIndex])
      .divide(SCALE_SCALES[scaledIndex]);
    pred = pred.add(
      standardizedIndicator.multiply(RIDGE_COEFS[scaledIndex])
    );
  }

  // Categorical one-hot effects.
  var pass = ee.String(currentS1.get('orbitProperties_pass'));
  var orbit = ee.Number(currentS1.get('relativeOrbitNumber_start'));

  var asc = ee.Image.constant(
    ee.Number(ee.Algorithms.If(
      ee.Algorithms.IsEqual(pass, 'ASCENDING'), 1, 0
    ))
  );
  var desc = ee.Image.constant(
    ee.Number(ee.Algorithms.If(
      ee.Algorithms.IsEqual(pass, 'DESCENDING'), 1, 0
    ))
  );

  pred = pred
    .add(asc.multiply(RIDGE_COEFS[CAT_COEF_INDEX.passAscending]))
    .add(desc.multiply(RIDGE_COEFS[CAT_COEF_INDEX.passDescending]))
    .add(ee.Image.constant(orbit.eq(120)).multiply(RIDGE_COEFS[CAT_COEF_INDEX.orbit120]))
    .add(ee.Image.constant(orbit.eq(171)).multiply(RIDGE_COEFS[CAT_COEF_INDEX.orbit171]))
    .add(ee.Image.constant(orbit.eq(18)).multiply(RIDGE_COEFS[CAT_COEF_INDEX.orbit18]))
    .add(ee.Image.constant(orbit.eq(98)).multiply(RIDGE_COEFS[CAT_COEF_INDEX.orbit98]));

  // V106 parity output: return the exact raw model features plus prediction.
  return features
    .addBands(pred)
    .updateMask(s1Feat.select('vv_median_50m_db').mask())
    .clip(workGeom)
    .set({
      'system:time_start': currentS1.get('system:time_start'),
      s1_image_id: currentS1.id(),
      orbit_pass: pass,
      relative_orbit: orbit,
      deployment_version: CONFIG.outputVersion
    });

}


// ============================================================================
// A09 V206B — PRODUCTION BATCH B04
// Window: WET_20190401_20190413
// Tile:   T04_NW
// Expected scene×tile exports from frozen V206A audit: 4
// ============================================================================
// IMPORTANT:
// - 50 m output is MODEL-SUPPORT / DOWNSCALED INFERENCE only.
// - Do NOT aggregate to 1 km inside GEE.
// - Run the batch-manifest CSV first, then image tasks ONE AT A TIME.
// - Offline postprocessing will aggregate 50 m -> 1 km after inference,
//   then compute the scene median, tile mosaic, and exact KHG mask.
// ============================================================================

var PRODUCTION_BATCH = {
  batchOrder: 4,
  batchId: 'B04',
  windowId: 'WET_20190401_20190413',
  windowCode: 'WET',
  startWib: '2019-04-01',
  endExclusiveWib: '2019-04-13',
  startUtc: '2019-03-31T17:00:00',
  endExclusiveUtc: '2019-04-12T17:00:00',
  tileId: 'T04_NW',
  tileRect: [102.5, -3.15, 103.833333, -1.5],
  expectedTaskCount: 4,
  tileBufferM: 12000
};

var productionTile = ee.Geometry.Rectangle(
  PRODUCTION_BATCH.tileRect,
  'EPSG:4326',
  false
);

var productionTileKhg = productionTile.intersection(
  aoi,
  ee.ErrorMargin(30)
);

var productionWorkGeom = productionTile.buffer(
  PRODUCTION_BATCH.tileBufferM,
  100
);

var productionScenes = s1
  .filterDate(
    ee.Date(PRODUCTION_BATCH.startUtc),
    ee.Date(PRODUCTION_BATCH.endExclusiveUtc)
  )
  .filterBounds(productionTileKhg)
  .sort('system:time_start');

// Metadata-only scene inventory. Small getInfo() call is intentional here:
// exports must be created client-side in the GEE Code Editor, while all raster
// prediction remains server-side.
var productionSceneMetaFc = ee.FeatureCollection(
  productionScenes.map(function(im) {
    im = ee.Image(im);
    var t = ee.Date(im.get('system:time_start'));
    var overlap = im.geometry().intersection(
      productionTileKhg,
      ee.ErrorMargin(30)
    );
    var tileKhgArea = productionTileKhg.area(30);
    var overlapArea = overlap.area(30);
    var overlapFraction = ee.Number(ee.Algorithms.If(
      tileKhgArea.gt(0),
      overlapArea.divide(tileKhgArea),
      0
    ));

    return ee.Feature(null, {
      system_index: im.get('system:index'),
      s1_image_id: im.id(),
      acquisition_utc: t.format('YYYY-MM-dd HH:mm:ss', 'UTC'),
      acquisition_wib_corrected: t
        .advance(CONFIG.wibOffsetHours, 'hour')
        .format('YYYY-MM-dd HH:mm:ss', 'UTC'),
      relative_orbit: im.get('relativeOrbitNumber_start'),
      orbit_pass: im.get('orbitProperties_pass'),
      scene_tile_khg_overlap_m2: overlapArea,
      scene_tile_khg_overlap_fraction: overlapFraction
    });
  })
);

var productionSceneInfo = productionSceneMetaFc.getInfo();
var productionRows = productionSceneInfo.features || [];

if (productionRows.length !== PRODUCTION_BATCH.expectedTaskCount) {
  throw new Error(
    'A09 V206B ABORTED: expected ' +
    PRODUCTION_BATCH.expectedTaskCount +
    ' scene×tile rows from frozen V206A audit, but found ' +
    productionRows.length + '. Do not run exports until investigated.'
  );
}

var productionDailyGpm = buildDailyGpmCollection(
  PRODUCTION_BATCH.startWib,
  PRODUCTION_BATCH.endExclusiveWib,
  productionWorkGeom
);

function compactUtc(s) {
  return String(s)
    .replace(/-/g, '')
    .replace(/:/g, '')
    .replace(' ', 'T');
}

function compactTile(s) {
  return String(s).replace(/_/g, '');
}

var manifestFeatures = [];

productionRows.forEach(function(row, idx) {
  var p = row.properties;
  var seq = String(idx + 1).padStart(2, '0');
  var orbit = String(p.relative_orbit).padStart(3, '0');
  var utcCompact = compactUtc(p.acquisition_utc);
  var taskName = [
    'A09_V206B',
    PRODUCTION_BATCH.batchId,
    PRODUCTION_BATCH.windowCode,
    compactTile(PRODUCTION_BATCH.tileId),
    'S' + seq,
    'O' + orbit,
    utcCompact
  ].join('_');

  var current = ee.Image(
    s1.filter(ee.Filter.eq('system:index', p.system_index)).first()
  );

  var gwl50 = predictScene(
    current,
    productionDailyGpm,
    productionWorkGeom
  )
  .select('gwl_pred_m')
  .clip(productionTile)
  .rename('gwl_pred_m')
  .toFloat();

  Export.image.toDrive({
    image: gwl50,
    description: taskName,
    folder: CONFIG.driveFolder,
    fileNamePrefix: taskName,
    region: productionTile,
    crs: CONFIG.exportCrs,
    scale: CONFIG.scale50m,
    maxPixels: CONFIG.maxPixels,
    fileFormat: 'GeoTIFF'
  });

  manifestFeatures.push(
    ee.Feature(null, {
      production_version: 'A09_V206B',
      batch_order: PRODUCTION_BATCH.batchOrder,
      batch_id: PRODUCTION_BATCH.batchId,
      window_id: PRODUCTION_BATCH.windowId,
      window_code: PRODUCTION_BATCH.windowCode,
      tile_id: PRODUCTION_BATCH.tileId,
      task_sequence: idx + 1,
      planned_export_name: taskName,
      s1_system_index: p.system_index,
      s1_image_id: p.s1_image_id,
      acquisition_utc: p.acquisition_utc,
      acquisition_wib_corrected: p.acquisition_wib_corrected,
      relative_orbit: p.relative_orbit,
      orbit_pass: p.orbit_pass,
      scene_tile_khg_overlap_m2: p.scene_tile_khg_overlap_m2,
      scene_tile_khg_overlap_fraction: p.scene_tile_khg_overlap_fraction,
      support_resolution_m: 50,
      primary_resolution_m: 1000,
      inference_engine: 'GEE native frozen A08 V102 Ridge',
      postprocess: 'offline 1km aggregation + scene median + tile mosaic + exact KHG mask',
      smap_peat_dtw_used: 0
    })
  );
});

Export.table.toDrive({
  collection: ee.FeatureCollection(manifestFeatures),
  description: 'A09_V206B_B04_WET_T04NW_BATCH_MANIFEST',
  folder: CONFIG.driveFolder,
  fileNamePrefix: 'A09_V206B_B04_WET_T04NW_BATCH_MANIFEST',
  fileFormat: 'CSV'
});

print('A09 V206B PRODUCTION BATCH');
print('Batch:', PRODUCTION_BATCH.batchId);
print('Window:', PRODUCTION_BATCH.windowId);
print('Tile:', PRODUCTION_BATCH.tileId);
print('Expected / found tasks:', PRODUCTION_BATCH.expectedTaskCount, productionRows.length);
print('Scene metadata:', productionSceneMetaFc);
print('RUN ORDER:');
print('1) Run the BATCH_MANIFEST CSV task first.');
print('2) Then run image exports ONE AT A TIME, in S01...SNN order.');
print('3) Do NOT run any 1-km GEE aggregation.');
print('4) If any 50-m export fails from memory, stop that batch and report it.');

Map.centerObject(productionTile, 8);
Map.addLayer(
  productionTileKhg,
  {color: '000000'},
  PRODUCTION_BATCH.batchId + ' KHG-in-tile',
  false
);
