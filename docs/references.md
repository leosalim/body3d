# References

Data sources, the literature the method builds on, and related work. The paper's bibliography
(`paper/references.bib`) holds the same entries.

## Data

- **BodyParts3D 4.0.** Database Center for Life Science (DBCLS), 2008–2013; licence CC BY 4.0
  since 2025. https://dbarchive.biosciencedbc.jp/en/bodyparts3d/ — Mitsuhashi N., Fujieda K.,
  Tamura T., Kawamoto S., Takagi T., Okubo K. BodyParts3D: 3D structure database for anatomical
  concepts. *Nucleic Acids Research* 37 (Database issue), D782–D785, 2009.
- **ANSUR II.** Gordon C.C. et al. *2012 Anthropometric Survey of U.S. Army Personnel: Methods and
  Summary Statistics.* Technical Report NATICK/TR-15/007, U.S. Army Natick Soldier Research,
  Development and Engineering Center, 2014. Public data: https://www.openlab.psu.edu/ansur2/
- **Foundational Model of Anatomy.** Rosse C., Mejino J.L.V. A reference ontology for biomedical
  informatics: the Foundational Model of Anatomy. *Journal of Biomedical Informatics* 36(6),
  478–500, 2003.

## Anatomy

- Standring S. (ed.). *Gray's Anatomy: The Anatomical Basis of Clinical Practice*, 41st ed.
  Elsevier, 2016.
- Federative Committee on Anatomical Terminology. *Terminologia Anatomica.* Thieme, 1998 — and the
  Brazilian Portuguese edition of the Sociedade Brasileira de Anatomia (*Terminologia Anatômica*).

## Body composition and anthropometry

- Kouri E.M., Pope H.G., Katz D.L., Oliva P. Fat-free mass index in users and nonusers of
  anabolic-androgenic steroids. *Clinical Journal of Sport Medicine* 5(4), 223–228, 1995.
- Schutz Y., Kyle U.U.G., Pichard C. Fat-free mass index and fat mass index percentiles in
  Caucasians aged 18–98 y. *International Journal of Obesity* 26(7), 953–960, 2002.
- Janssen I., Heymsfield S.B., Wang Z., Ross R. Skeletal muscle mass and distribution in 468 men
  and women aged 18–88 yr. *Journal of Applied Physiology* 89(1), 81–88, 2000.
- Lee R.C., Wang Z., Heo M., Ross R., Janssen I., Heymsfield S.B. Total-body skeletal muscle mass:
  development and cross-validation of anthropometric prediction models. *American Journal of
  Clinical Nutrition* 72(3), 796–803, 2000.
- Heymsfield S.B., McManus C., Smith J., Stevens V., Nixon D.W. Anthropometric measurement of
  muscle mass: revised equations for calculating bone-free arm muscle area. *American Journal of
  Clinical Nutrition* 36(4), 680–690, 1982.
- Hodgdon J.A., Beckett M.B. *Prediction of percent body fat for U.S. Navy men (women) from body
  circumferences and height.* Reports 84-11 and 84-29, Naval Health Research Center, San Diego,
  1984.
- Mosteller R.D. Simplified calculation of body-surface area. *New England Journal of Medicine*
  317(17), 1098, 1987.
- Müller W., Lohman T.G., Stewart A.D. et al. Subcutaneous fat patterning in athletes: selection
  of appropriate sites and standardisation of a novel ultrasound measurement technique. *British
  Journal of Sports Medicine* 50(1), 45–54, 2016.
- Midorikawa T., Sekiguchi O., Beekley M.D., Bemben M.G., Abe T. A comparison of organ-tissue
  level body composition between college-age male athletes and nonathletes. *International Journal
  of Sports Medicine* 28(2), 100–105, 2007. — SMM/FFM 0.477 in athletes against 0.447.
- Abe T., Buckner S.L., Dankel S.J., Jessee M.B., Mattocks K.T., Mouser J.G., Loenneke J.P.
  Skeletal muscle mass in human athletes: what is the upper limit? *American Journal of Human
  Biology* 30(3), e23102, 2018.
- Maden-Wilkinson T.M., Balshaw T.G., Massey G.J., Folland J.P. What makes long-term
  resistance-trained individuals so strong? A comparison of skeletal muscle morphology,
  architecture, and joint mechanics. *Journal of Applied Physiology* 128(4), 1000–1011, 2020. —
  quadriceps volumes by MRI ([validation/anatomy-checks.md](validation/anatomy-checks.md)).
- Deurenberg P., Weststrate J.A., Seidell J.C. Body mass index as a measure of body fatness: age-
  and sex-specific prediction formulas. *British Journal of Nutrition* 65(2), 105–114, 1991. — the
  girth-free body fat of the validation.

## Geometry, animation and estimation

- Kavan L., Collins S., Žára J., O'Sullivan C. Geometric skinning with approximate dual quaternion
  blending. *ACM Transactions on Graphics* 27(4), 105, 2008.
- Taubin G. A signal processing approach to fair surface design. *Proceedings of SIGGRAPH 95*,
  351–358, 1995.
- Garland M., Heckbert P.S. Surface simplification using quadric error metrics. *Proceedings of
  SIGGRAPH 97*, 209–216, 1997.
- Andrew A.M. Another efficient algorithm for convex hulls in two dimensions. *Information
  Processing Letters* 9(5), 216–219, 1979.
- Huber P.J. Robust estimation of a location parameter. *Annals of Mathematical Statistics* 35(1),
  73–101, 1964.
- Hoerl A.E., Kennard R.W. Ridge regression: biased estimation for nonorthogonal problems.
  *Technometrics* 12(1), 55–67, 1970. — the validation's baseline.
- Fleiss J.L. Measuring nominal scale agreement among many raters. *Psychological Bulletin* 76(5),
  378–382, 1971. — the view study's agreement.
- Levenberg K. A method for the solution of certain non-linear problems in least squares.
  *Quarterly of Applied Mathematics* 2(2), 164–168, 1944. — Marquardt D.W. An algorithm for
  least-squares estimation of nonlinear parameters. *Journal of the Society for Industrial and
  Applied Mathematics* 11(2), 431–441, 1963.
- The Khronos Group. *glTF 2.0 Specification* and the *KHR_mesh_quantization* extension.
  https://registry.khronos.org/glTF/
- three.js. https://threejs.org

## Related work

- Teran J., Sifakis E., Blemker S.S., Ng-Thow-Hing V., Lau C., Fedkiw R. Creating and simulating
  skeletal muscle from the Visible Human data set. *IEEE Transactions on Visualization and Computer
  Graphics* 11(3), 317–328, 2005.
- Lee S.-H., Sifakis E., Terzopoulos D. Comprehensive biomechanical modeling and simulation of the
  upper body. *ACM Transactions on Graphics* 28(4), 99, 2009.
- Saito S., Zhou Z.-Y., Kavan L. Computational bodybuilding: anatomically-based modeling of human
  bodies. *ACM Transactions on Graphics* 34(4), 41, 2015.
- Kadleček P., Ichim A.-E., Liu T., Křivánek J., Kavan L. Reconstructing personalized anatomical
  models for physics-based body animation. *ACM Transactions on Graphics* 35(6), 213, 2016.
- Loper M., Mahmood N., Romero J., Pons-Moll G., Black M.J. SMPL: a skinned multi-person linear
  model. *ACM Transactions on Graphics* 34(6), 248, 2015.
- Delp S.L., Anderson F.C., Arnold A.S. et al. OpenSim: open-source software to create and analyze
  dynamic simulations of movement. *IEEE Transactions on Biomedical Engineering* 54(11), 1940–1950,
  2007.
- Keller M., Zuffi S., Black M.J., Pujades S. OSSO: obtaining skeletal shape from outside.
  *Proceedings of CVPR*, 20492–20501, 2022.
- Keller M., Werling K., Shin S., Delp S., Pujades S., Liu C.K., Black M.J. From skin to skeleton:
  towards biomechanically accurate 3D digital humans (SKEL). *ACM Transactions on Graphics* 42(6),
  253, 2023.
- Keller M., Arora V., Dakri A., Chandhok S., Machann J., Fritsche A., Black M.J., Pujades S. HIT:
  estimating internal human implicit tissues from the body surface. *Proceedings of CVPR*,
  3480–3490, 2024.
- Brégier R., Fiche G., Bravo-Sánchez L., Lucas T., Armando M., Weinzaepfel P., Rogez G., Baradel F.
  Human mesh modeling for Anny body. arXiv:2511.03589, 2025.
- Seo H., Magnenat-Thalmann N. An automatic modeling of human bodies from sizing parameters.
  *Proceedings of the 2003 Symposium on Interactive 3D Graphics (I3D)*, 19–26, 2003.
- Wuhrer S., Shu C. Estimating 3D human shapes from measurements. *Machine Vision and
  Applications* 24(6), 1133–1147, 2013.
