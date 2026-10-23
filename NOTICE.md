# Notice — third-party data

[LICENSE](LICENSE) (MIT) covers the source code. The files named below are not covered by it:
they keep the licences given here.

## BodyParts3D

The 3D models (`public/models/*.glb`, and their copies in `dist/`) and the mesh catalog
(`catalog/bp3d-elements.json`) are derived from:

> **BodyParts3D, © The Database Center for Life Science licensed under CC Attribution 4.0
> International.**
> https://dbarchive.biosciencedbc.jp/en/bodyparts3d/ — licence:
> https://dbarchive.biosciencedbc.jp/en/bodyparts3d/lic.html

The derived models are distributed under the same licence,
[CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). **Changes made**: selection of
meshes, decimation and smoothing, the rectus abdominis cut out of the external-oblique mesh, the
latissimus dorsi and patellar ligaments synthesized, female proportions, layered hypertrophy as
morph targets, rigging and skinning, baked ambient occlusion, quantization into glTF, English and
Portuguese labels. The method is described in `docs/anatomy.md` and `docs/pipeline.md`.

The OBJ headers of the BodyParts3D 4.0 release still mention the earlier CC BY-SA 2.1 Japan
licence; DBCLS relicensed the database under CC BY 4.0 in 2025.

**Attribution is required wherever the models are displayed.** The viewer shows the credit line
"BodyParts3D © DBCLS · CC BY 4.0" (linked to the licence) by default; turn it off (`credit: false`)
only when the application attributes BodyParts3D elsewhere, for example on an "About" screen. The
models also carry the attribution text in `extras.attribution`.

## ANSUR II

`src/calibration.generated.js` contains statistics (mean curves, a typical body per FFMI and
covariances) computed by `dev/calibrate.mjs` from the 2012 Anthropometric Survey of U.S. Army
Personnel (ANSUR II; Gordon et al. 2014), a public dataset. The raw data is not redistributed in
this repository.

## three.js

The standalone bundle (`dist/lib/body3d.standalone.js`) includes three.js
(https://threejs.org), © three.js authors, MIT licence.
