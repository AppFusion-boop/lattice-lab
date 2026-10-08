# Lattice — virtual science lab

A Georgian/English interactive educational prototype built with React, TypeScript, Vite, Lucide icons, Canvas 2D projection and SVG plots. No account or external scientific service is needed. All computed data is explicitly simulated.

## Run

Requires Node.js 22.12+ (tested on Node 24).

- npm install
- npm run dev
- npm test
- npm run build

The production output is dist/. Hosting configuration is in .openai/hosting.json. The platform has no application backend; notebook records and XP persist only in the current browser. Export data before clearing browser storage. Maximum notebook length: 40 entries.

## Demonstration workflow

1. Open XRD and leave crystallite size at 45 nm.
2. Pin Compare to retain the baseline.
3. Reduce size to 20 nm or less and run the experiment.
4. Observe broader diffraction peaks and complete the learning mission.
5. Add an observation to the notebook; export CSV or the full JSON report.
6. Switch to another instrument. Each has its own parameterized model, specimen presets and axes.

## Scope and limits

Eight instrument families are represented by educational models:

- XRD: cubic preset Bragg angles, Scherrer size broadening combined in quadrature with Gaussian instrument broadening, illustrative intensities.
- SEM/EDS: preset line spectrum and detector broadening; procedural surface schematic. No quantitative electron microscopy images or Monte Carlo transport.
- NMR: preset proton shifts and simple illustrative multiplets; not a molecular structure predictor or 2D NMR solver.
- AFM: synthetic height line profile with smoothing; not atomistic force microscopy.
- Electrochemistry: ideal RC Randles EIS semicircle; no diffusion, CV or charge/discharge solver.
- HPLC: preset retention-time model and Gaussian peaks; not calibrated analytical chemistry.
- UV–Vis: Beer–Lambert scaling with illustrative absorption bands; no FTIR or quantum chemistry solver.
- DSC/TGA: illustrative TGA logistic mass loss; no quantitative DSC heat flow or kinetic parameter fitting.

Noise is seeded uniform synthetic noise, not calibrated Johnson–Nyquist or counting noise. Drift is an illustrative linear baseline term and is unavailable for the Nyquist plot. The acquisition timer is a UI animation, not a prediction of physical measurement time.

CIF import reads cubic cell lengths and angles only (2–20 Å; equal lengths and 90° angles). It does not parse atomic coordinates, symmetry operations, occupancy or displacement parameters. The selected preset supplies the motif and illustrative reflection intensities.

CSV files include simulated-data labeling, model description, units, parameters, seed and model version. JSON exports also retain the acquisition timestamp and observation. No proprietary vendor-format compatibility is claimed.

## Scientific roadmap

Validate one XRD reference-material workflow with instrument scientists before expanding fidelity. Compare peak positions, widths, integrated intensities and uncertainty against measured reference data. Add a documented scientific-engine adapter (for example a separately operated Python service), calibration models, instrument response functions and regression fixtures. Validate each supported method independently. The current prototype does not run GSAS-II, CASINO, Spinach or other external research engines.

Reference: https://journals.iucr.org/j/issues/2024/05/00/oc5037/index.html

## Verification

Automated tests cover the Si 111 Bragg angle, wavelength dependence, Scherrer broadening, finite model outputs across samples and control extrema, seeded reproducibility, Beer–Lambert scaling, ideal RC semicircle geometry, CIF rejection and EDS excitation thresholds. These are implementation consistency checks, not experimental validation.


## Scenario lab: tunnel pressure comparison

The default screen now includes synchronized dry and ceiling-mist pressure maps. A Web Worker computes a 201 × 41 finite-difference linear acoustic model. Users can change tunnel length/height, horizontal probe distance, end boundaries, hypothetical damping and hypothetical fill time; play, pause, scrub and export the probe histories.

Pressure is normalized to a fixed initial Gaussian pulse. Color scales are identical in both scenes and clip at ±0.25; exported values remain unclipped. The figure represents a sensor 1.3 m above the floor, not a simulated body or injury model. Simulation time is shown in milliseconds, with an 8-second slow-motion playback at 1×.

This is NOT methane combustion, a nonlinear shock solver or a calibrated water-mist effectiveness prediction. Mist is represented only by an assumed damping coefficient in the central 60% of the tunnel, filling downward from t = 0. No gas composition, ignition energy, droplet size, flow-rate correlation, evaporation, turbulence, thermal coupling or chemical kinetics is computed. The damped-wave model cannot represent spray-induced combustion intensification, which can occur in real configurations.

References:
- https://www.nist.gov/document/r0002177pdf
- https://arxiv.org/abs/2009.09596

Scenario tests verify a zero-damping control, synchronized clocks, finite outputs, energy decrease under the chosen damping hypothesis, causal arrival and input validation. These tests do not constitute CFD or experimental validation.


## Dual-channel oscilloscope

The DSO-02 simulator includes two ideal signal generators (sine, square, triangle), frequency, Vpp, phase and DC offset controls; separate Time/Div and Volts/Div scaling; channel visibility; ideal DC-removal AC coupling; rising/falling edge triggering; Auto and Normal trigger modes; Run/Stop/Single acquisition; Auto Set; draggable time cursors; period, frequency, Vpp and RMS readouts; and a 2,000-point CSV capture.

Stop retains the last captured signal and settings. Measurements use a full period of that synthetic signal, not a hardware acquisition. The displayed effective sample rate depends on the time window; an undersampling notice appears when a source exceeds Nyquist. Physical bandwidth, ADC quantization, probe loading, filter transients and circuit behavior are not modeled.

Reference: https://www.tek.com/en/documents/primer/evaluating-oscilloscopes

## Experiment builder

The default workspace is a typed React Flow graph with a scene editor and connected results. The initial example routes dry and mist pressure sensors through explicit pressure-to-voltage mappings to a two-channel display. Move sensors in the scene or change their normalized coordinates in the inspector; output samples use bilinear interpolation of the actual acoustic grid. Connect handles by dragging, or choose input sources in the inspector. Run/pause and scrub share one timeline.

Node types: scene, pressure sensor, unit mapping, causal low-pass filter, voltage generator, oscilloscope, educational scientific instrument, and XY spectrum display. The instrument source supports the existing eight models. Incompatible types, occupied inputs and feedback cycles are rejected. This version supports one scene and up to 40 nodes. Connections and semantic parameter edits re-evaluate downstream signals; position-only graph changes do not re-run the physical solver.

Save stores the current graph in this browser. JSON export/import preserves the graph and parameters and validates imported data; CSV exports connected signal or spectrum data. Undo/redo applies to graph structure, parameter changes and node/sensor drags. The flow scope is a shared-timeline viewer; the separate Oscilloscope workspace retains the full generator/trigger controls.

Pressure is normalized p/p0, and the user-selected voltage conversion is an assumed sensitivity, not calibrated hardware. This scene retains the acoustic solver limitations documented above: no methane chemistry, reacting-flow CFD, droplet physics or injury model.
