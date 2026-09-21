# Google Earth Engine Processing Scripts — Paper A

**Companion code repository for:**
"Field-Calibrated Multisource Remote Sensing and Machine Learning for Peatland Groundwater Level Mapping in South Sumatra, Indonesia" — Irfan et al., submitted to *Remote Sensing Applications: Society and Environment*.

This repository contains the Google Earth Engine (GEE) JavaScript scripts used for satellite predictor extraction, SMAP composite construction, field–satellite timestamp auditing, and spatial deployment (scene-level GWL prediction) described in Section 2 of the manuscript. Offline Python code (model fitting, LOSO/temporal validation, raster aggregation, and bootstrap uncertainty) is maintained separately and is not part of this GEE repository.

## How to run a script

These are Earth Engine **Code Editor** scripts, not a standalone package:

1. Open <https://code.earthengine.google.com/>.
2. Create a new script (or open an existing one) and paste the contents of the `.js` file.
3. Each script's `CONFIG` block at the top lists the Earth Engine assets it expects (AOI boundary, station coordinates, Drive export folder). These reference private assets under the authors' GEE project and are **not publicly readable**. Reviewers who need to execute the scripts rather than audit them are welcome to request read access to the underlying assets from the corresponding author; the source datasets themselves (Sentinel-1, GPM IMERG, SMAP L4) are public and referenced in Section 2.2 / Table 1 of the manuscript.
4. Station coordinates for the 16 in-AOI BRGM/SIPALAGA monitoring locations are listed directly in `03_timestamp_audit/AUDIT-02_...Audit.js` for independent verification.

## Repository structure and mapping to the manuscript

| Folder | Script(s) | Manuscript correspondence |
| --- | --- | --- |
| `01_predictor_extraction/` | `A01_S1_BACKSCATTER_BRGM12_V100.js` | Sentinel-1 VV/VH station-level backscatter extraction (30 m and 50 m support) — Section 2.5; feeds Table 3/4 model input `A01_S1_BACKSCATTER_BRGM12_2019_2023_V100.csv` |
| | `A06_V100.js` | Nearest-SMAP-L4 hydrological anchoring at Sentinel-1 acquisition times — Section 2.5, second paragraph |
| | `GPM_IMERG_BRGM_16.js` | Raw daily GPM IMERG V07 extraction at 16 BRGM stations — Section 2.4, first step |
| | `GPM_Calibrated_Features_BRGM16_2015_2024.js` | Two-stage (logistic occurrence + Huber-in-log-space amount) IMERG calibration and construction of the 1/3/7/14/30-day antecedent-rainfall, rainy-day-count, and dry-spell features — Section 2.4; corresponds to Table 2 / Fig. 4 |
| | `A-03A-Sentinel-2-Station-Context-for-Paper-A.js` | Exploratory Sentinel-2 / Dynamic World station-level context. **Not referenced in the current Paper A manuscript text** — included here for completeness of the repository; please confirm whether this should be cited or omitted before the camera-ready version. |
| `02_smap_weekly_composites/` | `D1_SMAP_L4_V8_Weekly_Protocol.js` | Defines the Monday–Monday (WIB) weekly SMAP L4 compositing protocol |
| | `D3_..._v1.0.0_FINAL.js` + `D3_historical_2015_2024_QA_lineage/` (v1.0.1–v1.0.4) | Historical weekly SMAP L4 V8 composites, 2015–2024. The QA-lineage subfolder is kept intentionally: it documents the iterative QA corrections (band selection, per-band QA logic) preceding the final asset export (`v1.0.4_QA_ONLY_asset_export.js`), consistent with the manuscript's emphasis on auditable data preparation (Section 2.3, 2.7) |
| `03_timestamp_audit/` | `AUDIT-02_Sentinel-1_Acquisition_and_Field-Matching_Readiness_Audit.js` | Field–satellite timestamp audit — directly corresponds to **Section 2.3** and the 1,131→1,133 observation reconciliation reported in **Section 3.2** |
| `04_spatial_deployment/` | `A09_V206A_GEE_PRODUCTION_MANIFEST.js` | Full-AOI Sentinel-1 scene × tile inventory for the wet/dry production run — Section 2.7 |
| | `wet_dry_tile_production_V206B/` (B01–B10) | The 10 production exports (5 PHU tiles × wet/dry) implementing the frozen Ridge(α) GWL model at 50-m support — Section 2.7 and **Section 3.7 / Table 6**. Tile codes (T02, T03, T04, T05, T06) correspond to the five deployment tiles intersecting the PHU mask; compass suffixes (NC/SC/SE/NW/NE) are the authors' internal tile labels |
| | `development_and_parity_tests/` | Development history: V110 (initial spatial pilot) → V113/V114/V115 (export architecture tests) → V200/V204-205 (GEE-vs-offline-Python numerical parity tests). These correspond to the **0.001-m acceptance-threshold cross-check** described in Section 2.7, retained for methodological transparency rather than as production code |

## A note on the version history kept in this repository

Several scripts appear in more than one version (e.g., the SMAP QA lineage, the A09 development series). These are **not duplicates** — each is a dated, purpose-noted step in the processing pipeline, and the header comment of every script states its role and, where applicable, which prior version it corrects. They are retained rather than deleted so that a reviewer can trace how the final production configuration (clearly marked "FINAL" or, for the A09 series, the V206A/V206B scripts) was arrived at, consistent with the manuscript's overall emphasis on explicit, auditable methodology (Sections 2.3, 2.6, 2.7).

## Corresponding offline components

The following are described in the manuscript but are **not** part of this GEE repository (Python-side): model fitting and nested LOSO/temporal validation (Section 2.6), raster aggregation/mosaicking/PHU clipping (Section 2.7), and bootstrap uncertainty quantification (Section 2.7, 3.8). Contact the corresponding author for access consistent with the Data Availability statement in the manuscript.
