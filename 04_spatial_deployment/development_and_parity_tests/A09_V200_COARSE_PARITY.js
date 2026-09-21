/*
A-09 | Spatial Deployment Gate for Final Peat GWL Model
Version: V110 PIXELWISE TEMPORAL PARITY
Project: Integrated Peat Hydrology & Weekly Fire Forecasting — South Sumatra

SCIENTIFIC ROLE
---------------
A-09 applies the frozen A-08 field-validated GWL model spatially.

Frozen model:
  Ridge(alpha = 0.1)
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
  outputVersion: 'A09_V200',

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

  validatedMacroRmseM: 0.27623755979806985,
  validatedPooledRmseM: 0.299865481334646,
  validatedPooledR2: 0.5069518103684552
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
// Exact A-08 sklearn deployment parameters
// -----------------------------------------------------------------------------
var NUMERIC_NAMES = ["gpm_calibrated_accum_1d_mm", "gpm_calibrated_accum_3d_mm", "gpm_calibrated_accum_7d_mm", "gpm_calibrated_accum_14d_mm", "gpm_calibrated_accum_30d_mm", "gpm_dry_streak_days", "gpm_wet_days_7d", "gpm_wet_days_14d", "gpm_wet_days_30d", "doy_sin", "doy_cos", "smap_sm_surface", "smap_sm_rootzone", "smap_sm_profile", "smap_surface_wetness", "smap_rootzone_wetness", "smap_profile_wetness", "smap_land_fraction_saturated", "smap_surface_temp_K", "smap_vegetation_greenness_fraction", "smap_leaf_area_index", "vv_median_50m_db", "vh_median_50m_db", "vv_minus_vh_50m_db", "vh_vv_ratio_linear_50m", "rvi_50m", "angle_median_50m_deg", "days_since_prev_same_orbit_50m", "delta_vv_prev_same_orbit_50m_db", "delta_vh_prev_same_orbit_50m_db", "delta_vvdiff_prev_same_orbit_50m_db", "vv_anom_prev3_same_orbit_50m_db", "vh_anom_prev3_same_orbit_50m_db", "n_prev3_history_50m"];
var NUMERIC_MEDIANS = [0.0, 10.667365746634207, 23.82927686790083, 49.44639869902345, 109.74603852233328, 1.0, 3.0, 7.0, 15.0, -0.0730451882110474, 0.2603764827344581, 0.6688991189002991, 0.8970564603805542, 0.9229185581207277, 0.7192619442939758, 0.9645598530769348, 0.9923851490020752, 0.16375732421875, 299.1618347167969, 0.9426777958869934, 3.42871642112732, -9.152468763362196, -15.4568238339344, 6.231157817266695, 0.23816844341262355, 0.7694217848298147, 39.32833480834961, 12.0, -0.0058000292006106235, 0.006033059017751086, -0.018871396564720477, -0.008752058895769466, -0.00562967224701616, 3.0];
var SCALE_MEANS = [3.592200814874778, 10.532289447601691, 24.228074394575028, 48.76226517340121, 104.07199292445813, 3.425287356321839, 3.212201591511936, 6.451812555260831, 13.801061007957559, -0.04215499829981788, 0.15349171086459618, 0.616853419727556, 0.8481432774971271, 0.912056967602906, 0.663281298258155, 0.9119770766147779, 0.9807055333775825, 0.1790826072780828, 298.5074528998553, 0.9393425884234178, 3.3694017482583867, -10.46541648321125, -16.763394568902687, 6.297978085691438, 0.24729054940360135, 0.7796220544475548, 39.46038878248698, 14.206898639355535, -0.0009375454819207687, 0.0036669385242990168, -0.0046791610178522364, -0.025176932592164403, -0.012016815707927996, 2.9398762157382845, 0.010610079575596816, 0.010610079575596816, 0.010610079575596816, 0.010610079575596816, 0.010610079575596816, 0.010610079575596816];
var SCALE_SCALES = [4.04088709754848, 8.582948274389585, 15.843595895091463, 27.24799745522372, 51.727419576082085, 8.376973448509748, 1.9641057562625026, 3.401789171968654, 6.5132822687399, 0.7170043847309439, 0.6786515770929897, 0.1755955758332069, 0.10383659450824621, 0.023925086943867024, 0.18881675617256963, 0.11165426811074455, 0.025721111616410042, 0.1545893055712299, 2.1862624115882183, 0.023784782978509146, 0.6723408120017228, 3.729445057640723, 3.536791393710762, 1.4195552982853143, 0.08398098150864373, 0.2013830900832197, 3.8929762567358273, 13.901121655333053, 1.6911439113713207, 1.4966711889351814, 1.4664831600252197, 1.6667685277204924, 1.4150210744811782, 0.36889634268279503, 0.10245733642349054, 0.10245733642349054, 0.10245733642349054, 0.10245733642349054, 0.10245733642349054, 0.10245733642349054];
var RIDGE_COEFS = [0.013670940205788582, 0.011416382935724667, 0.08285895253169377, 0.059498166954191724, -0.0078072649662924085, -0.01618999243773867, -0.05308455075851083, -0.044001049951541464, 0.07738090361434884, 0.03519585665954816, -0.07388457133965269, -0.08347816942825399, 0.21768054472590767, 0.054803956304143316, -0.06556042143614912, 0.17273684100434358, -0.20733786455019163, 0.07875412120010898, 0.00654520791063139, 0.01852143858393624, -0.09337425480712752, -0.11522587084804949, -0.07040135216296703, -0.12731709594965546, 0.21392821505762383, -0.3006201053914697, 0.0718438016467465, -0.0004063323986968156, 0.014063833525821627, 0.01146257675308672, 0.004522006479256503, 0.0350104038664875, -0.009010062854170433, -0.07584156711843962, -0.00442126391784323, -0.004421263917853269, -0.004421263917864401, -0.004421263917864401, -0.0044212639178644025, -0.004421263917864401, 0.031413138809768225, -0.03141313880977363, 0.039634920406322174, -0.14860446324412022, -0.07104805921503897, 0.1800176020521997];
var MISSING_INDICATOR_NUMERIC_INDICES = [27, 28, 29, 30, 31, 32];
var TRAIN_DOMAIN = {"gpm_calibrated_accum_1d_mm": {"min": 0.0, "p01": 0.0, "median": 0.0, "p99": 12.522366279379753, "max": 13.755712463912817}, "gpm_calibrated_accum_3d_mm": {"min": 0.0, "p01": 0.0, "median": 10.667365746634207, "p99": 27.90285339487667, "max": 38.5194055947269}, "gpm_calibrated_accum_7d_mm": {"min": 0.0, "p01": 0.0, "median": 23.82927686790083, "p99": 59.55100297575905, "max": 67.08247693314331}, "gpm_calibrated_accum_14d_mm": {"min": 0.0, "p01": 0.0, "median": 49.44639869902345, "p99": 101.24101100654684, "max": 108.8097287187944}, "gpm_calibrated_accum_30d_mm": {"min": 0.0, "p01": 0.0, "median": 109.74603852233328, "p99": 201.55395975687208, "max": 226.6706659129053}, "gpm_dry_streak_days": {"min": 0.0, "p01": 0.0, "median": 1.0, "p99": 49.0, "max": 61.0}, "gpm_wet_days_7d": {"min": 0.0, "p01": 0.0, "median": 3.0, "p99": 7.0, "max": 7.0}, "gpm_wet_days_14d": {"min": 0.0, "p01": 0.0, "median": 7.0, "p99": 12.0, "max": 13.0}, "gpm_wet_days_30d": {"min": 0.0, "p01": 0.0, "median": 15.0, "p99": 24.0, "max": 26.0}, "doy_sin": {"min": -0.9999994220246924, "p01": -0.9998699583618592, "median": -0.0730451882110474, "p99": 0.9995786855478958, "max": 0.9999300657962056}, "doy_cos": {"min": -0.9999791929590824, "p01": -0.998445021526859, "median": 0.2603764827344581, "p99": 0.9994082116062598, "max": 0.9999907524084426}, "smap_sm_surface": {"min": 0.0389087870717048, "p01": 0.09967927038669586, "median": 0.6688991189002991, "p99": 0.835951727628708, "max": 0.8660286664962769}, "smap_sm_rootzone": {"min": 0.5053269863128662, "p01": 0.5394361615180969, "median": 0.8970564603805542, "p99": 0.92802454829216, "max": 0.9287877082824708}, "smap_sm_profile": {"min": 0.8206506967544556, "p01": 0.8328285992145539, "median": 0.9229185581207277, "p99": 0.9290541589260101, "max": 0.9292423725128174}, "smap_surface_wetness": {"min": 0.0418342798948287, "p01": 0.10718871429562565, "median": 0.7192619442939758, "p99": 0.8989246547222138, "max": 0.9313469529151917}, "smap_rootzone_wetness": {"min": 0.5433947443962097, "p01": 0.5798324346542358, "median": 0.9645598530769348, "p99": 0.9975768387317658, "max": 0.99871563911438}, "smap_profile_wetness": {"min": 0.8822808861732483, "p01": 0.8955594778060914, "median": 0.9923851490020752, "p99": 0.9990310072898865, "max": 0.9992801547050476}, "smap_land_fraction_saturated": {"min": 0.0, "p01": 6.087796759809528e-20, "median": 0.16375732421875, "p99": 0.5135742187500002, "max": 0.58056640625}, "smap_surface_temp_K": {"min": 293.5349426269531, "p01": 294.4123474121094, "median": 299.1618347167969, "p99": 303.7102935791016, "max": 304.64532470703125}, "smap_vegetation_greenness_fraction": {"min": 0.8857007026672363, "p01": 0.894502854347229, "median": 0.9426777958869934, "p99": 0.9788476407527923, "max": 0.9790811538696288}, "smap_leaf_area_index": {"min": 1.857423186302185, "p01": 2.0001972317695618, "median": 3.42871642112732, "p99": 5.0865243911743185, "max": 5.458990573883057}, "vv_median_50m_db": {"min": -24.58046208864254, "p01": -22.367074705182347, "median": -9.152468763362196, "p99": -7.0032292872793285, "max": -6.262348975153329}, "vh_median_50m_db": {"min": -28.00401550353314, "p01": -27.059928786036014, "median": -15.4568238339344, "p99": -12.812985853458558, "max": -12.05204170774149}, "vv_minus_vh_50m_db": {"min": 0.5016695620301981, "p01": 2.853089336924205, "median": 6.231157817266695, "p99": 9.938973592575886, "max": 12.634024378603648}, "vh_vv_ratio_linear_50m": {"min": 0.05452523702204416, "p01": 0.10141525320026681, "median": 0.23816844341262355, "p99": 0.5184356019631463, "max": 0.8909083796145821}, "rvi_50m": {"min": 0.20682382974928973, "p01": 0.3683087843690874, "median": 0.7694217848298147, "p99": 1.3657045179590084, "max": 1.8846145888806591}, "angle_median_50m_deg": {"min": 31.975391387939453, "p01": 31.97885341644287, "median": 39.32833480834961, "p99": 45.555626678466794, "max": 45.58409881591797}, "days_since_prev_same_orbit_50m": {"min": 11.999976851851851, "p01": 11.999988425925926, "median": 12.0, "p99": 72.00005787037037, "max": 372.00008101851853}, "delta_vv_prev_same_orbit_50m_db": {"min": -12.828538678094132, "p01": -5.361918201802205, "median": -0.0058000292006106235, "p99": 5.026438529906895, "max": 11.126745897023833}, "delta_vh_prev_same_orbit_50m_db": {"min": -6.859819118248478, "p01": -4.400689657639924, "median": 0.006033059017751086, "p99": 4.450837254926518, "max": 7.069481411202474}, "delta_vvdiff_prev_same_orbit_50m_db": {"min": -8.584654775419002, "p01": -3.7924092612563176, "median": -0.018871396564720477, "p99": 3.2397810302414762, "max": 8.828807349933511}, "vv_anom_prev3_same_orbit_50m_db": {"min": -11.245919724535876, "p01": -5.5031096009271305, "median": -0.008752058895769466, "p99": 5.376898651631878, "max": 10.831798683409806}, "vh_anom_prev3_same_orbit_50m_db": {"min": -7.773697852003018, "p01": -4.308097147555567, "median": -0.00562967224701616, "p99": 4.159030354842995, "max": 6.986606365758583}, "n_prev3_history_50m": {"min": 0.0, "p01": 0.3000000000000007, "median": 3.0, "p99": 3.0, "max": 3.0}};
var RIDGE_INTERCEPT = -0.14848599779718874;

// Coefficient layout:
//   0..33  = standardized numeric predictors
//   34..39 = standardized missing indicators
//   40..41 = orbit_pass ASCENDING/DESCENDING
//   42..45 = relative orbit 120/171/18/98
var CAT_COEF_INDEX = {
  passAscending: 40,
  passDescending: 41,
  orbit120: 42,
  orbit171: 43,
  orbit18: 44,
  orbit98: 45
};

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
// A09 V200 — CORRECTED-TIME COARSE PREDICTOR PARITY
//
// GEE computes ONLY GPM + SMAP for the representative target epoch.
// Sentinel-1 static/temporal features are reconstructed offline by epoch.
// No Ridge inference is executed in GEE.
// -----------------------------------------------------------------------------

var TILE_V200 = {
  id: 'T05_NC',
  rect: [103.833333, -3.15, 105.166667, -1.5]
};

var TARGET_SYSTEM_INDEX_V200 =
  'S1A_IW_GRDH_1SDV_20190402T224049_20190402T224114_026617_02FC54_6C84';

var CORE_STATION_ROWS_V200 = [
  ['BRG_160205_02','Tanjung Serang',104.911705,-3.447086],
  ['BRG_160214_02','Padang Sugihan 2',105.216600,-3.090585],
  ['BRG_160214_03','Padang Sugihan 3',105.232200,-3.019940],
  ['BRG_160224_01','Cinta Jaya 1',104.977500,-3.392495],
  ['BRG_160224_02','Cinta Jaya 2',104.965100,-3.478628],
  ['BRG_160224_03','Cinta Jaya 3',104.964700,-3.432265],
  ['BRG_160609_01','Muara Medak 1',103.928600,-1.795132],
  ['BRG_160611_01','Karang Agung',104.411300,-2.281653]
];

var coreStationsV200 = ee.FeatureCollection(
  CORE_STATION_ROWS_V200.map(function(r) {
    return ee.Feature(
      ee.Geometry.Point([r[2], r[3]]),
      {
        station_code: r[0],
        station_name: r[1]
      }
    );
  })
);

var tileV200 = ee.Geometry.Rectangle(
  TILE_V200.rect, 'EPSG:4326', false
);
var workV200 = tileV200.buffer(12000, 100);

var targetV200 = ee.Image(
  s1.filter(ee.Filter.eq('system:index', TARGET_SYSTEM_INDEX_V200)).first()
);

var targetUtcV200 = ee.Date(targetV200.get('system:time_start'));
var targetDayWibV200 = dayStartWibFromS1(targetV200);
var correctedWibV200 = targetUtcV200.advance(CONFIG.wibOffsetHours, 'hour');

var dailyGpmV200 = buildDailyGpmCollection(
  targetDayWibV200,
  targetDayWibV200.advance(1, 'day'),
  workV200
);

var gpmV200 = gpmAntecedentFeatures(
  targetV200, dailyGpmV200, workV200
);

var smapV200 = nearestSmap(
  targetV200, workV200
);

var coarseV200 = gpmV200
  .addBands(smapV200)
  .select([
    'gpm_calibrated_accum_1d_mm',
    'gpm_calibrated_accum_3d_mm',
    'gpm_calibrated_accum_7d_mm',
    'gpm_calibrated_accum_14d_mm',
    'gpm_calibrated_accum_30d_mm',
    'gpm_dry_streak_days',
    'gpm_wet_days_7d',
    'gpm_wet_days_14d',
    'gpm_wet_days_30d',
    'doy_sin',
    'doy_cos',
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
  ])
  .reproject({
    crs: CONFIG.exportCrs,
    scale: CONFIG.scale1km
  })
  .clip(tileV200);

var parityV200 = coarseV200.reduceRegions({
  collection: coreStationsV200,
  reducer: ee.Reducer.first(),
  scale: CONFIG.scale1km,
  crs: CONFIG.exportCrs,
  tileScale: 4
}).map(function(ft) {
  return ee.Feature(ft).set({
    representative_s1_system_index: TARGET_SYSTEM_INDEX_V200,
    acquisition_utc: targetUtcV200.format(
      'YYYY-MM-dd HH:mm:ss', 'UTC'
    ),
    acquisition_wib_corrected: correctedWibV200.format(
      'YYYY-MM-dd HH:mm:ss', 'UTC'
    ),
    corrected_s1_day_wib: targetDayWibV200.format('YYYY-MM-dd'),
    gpm_feature_day_wib: targetDayWibV200.advance(-1, 'day').format('YYYY-MM-dd'),
    relative_orbit_start: targetV200.get('relativeOrbitNumber_start'),
    orbit_pass: targetV200.get('orbitProperties_pass'),
    version: 'A09_V200'
  });
});

Export.table.toDrive({
  collection: parityV200,
  description: 'A09_V200_COARSE_PARITY',
  folder: CONFIG.driveFolder,
  fileNamePrefix: 'A09_V200_COARSE_PARITY',
  fileFormat: 'CSV'
});

// OPTIONAL — run this raster task ONLY after station parity is approved.
Export.image.toDrive({
  image: coarseV200.toFloat(),
  description: 'A09_V200_EPOCH_GPM_SMAP_1KM_T05NC',
  folder: CONFIG.driveFolder,
  fileNamePrefix: 'A09_V200_EPOCH_GPM_SMAP_1KM_T05NC',
  region: tileV200,
  crs: CONFIG.exportCrs,
  scale: CONFIG.scale1km,
  maxPixels: CONFIG.maxPixels,
  fileFormat: 'GeoTIFF'
});

print('A09 V200 CORRECTED-TIME COARSE PARITY');
print('Representative target UTC:',
      targetUtcV200.format('YYYY-MM-dd HH:mm:ss', 'UTC'));
print('Corrected WIB:',
      correctedWibV200.format('YYYY-MM-dd HH:mm:ss', 'UTC'));
print('GPM feature day t-1:',
      targetDayWibV200.advance(-1, 'day').format('YYYY-MM-dd'));
print('Relative orbit:', targetV200.get('relativeOrbitNumber_start'));
print('Orbit pass:', targetV200.get('orbitProperties_pass'));
print('RUN A09_V200_COARSE_PARITY FIRST.');
print('DO NOT run the raster export until parity is approved.');
print('No S1 temporal graph and no Ridge inference in GEE.');

Map.centerObject(tileV200, 8);
Map.addLayer(tileV200, {color:'blue'}, 'A09 V200 T05_NC');
Map.addLayer(coreStationsV200, {color:'red'}, 'Core stations');
