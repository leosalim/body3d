"""Anatomical selection: what goes into the model, under which name and in which group.

Explicit lists only — nothing is included because a classifier guessed it:

- GROUPS: groups that can be activated in a training context. Every muscle belongs to one.
- MUSCLES: right-side muscles by their BodyParts3D (FMA) concept name; the left side is the
  same name with "right" replaced by "left". A muscle may join several meshes (heads).
- TISSUES: visible connective tissue (tendons, fasciae), never activated.
- TRAINING_GROUPS: a 25-group gym vocabulary (English and Brazilian Portuguese names) mapped
  onto the anatomical groups with weights.

What BodyParts3D 4.0 lacks and the pipeline builds is in SYNTHETIC (see synth.py): latissimus
dorsi and patellar ligament; rectus abdominis ships fused into the external-oblique mesh and is
cut out of it (split.py).

Labels are given in English and Brazilian Portuguese (Terminologia Anatomica / Terminologia
Anatômica da SBA). Ids are stable English codes: the viewer, the GLB and every consumer key on
them, so renaming one is a breaking change.
"""
from __future__ import annotations

# --------------------------------------------------------------------------
# Body areas, used to group the activatable groups in a user interface.
# --------------------------------------------------------------------------
AREAS = [
    # id           English        Portuguese
    ("trunk",      "Trunk",       "Tronco"),
    ("back",       "Back",        "Costas"),
    ("shoulders",  "Shoulders",   "Ombros"),
    ("arms",       "Arms",        "Braços"),
    ("forearms",   "Forearms",    "Antebraços"),
    ("neck",       "Neck",        "Pescoço"),
    ("hips",       "Hips",        "Quadril"),
    ("thighs",     "Thighs",      "Coxas"),
    ("lower-legs", "Lower legs",  "Pernas"),
]

# --------------------------------------------------------------------------
# Activatable groups.
# --------------------------------------------------------------------------
GROUPS = [
    # id                   English                          Portuguese                           area
    ("chest-upper",        "Upper chest",                   "Peitoral superior",                 "trunk"),
    ("chest-middle",       "Middle chest",                  "Peitoral médio",                    "trunk"),
    ("chest-lower",        "Lower chest",                   "Peitoral inferior",                 "trunk"),
    ("serratus",           "Serratus anterior",             "Serrátil anterior",                 "trunk"),
    ("abs",                "Rectus abdominis",              "Reto do abdome",                    "trunk"),
    ("obliques",           "Obliques",                      "Oblíquos",                          "trunk"),
    ("intercostals",       "Intercostals",                  "Intercostais",                      "trunk"),
    ("lats",               "Latissimus dorsi",              "Latíssimo do dorso",                "back"),
    ("teres-major",        "Teres major",                   "Redondo maior",                     "back"),
    ("traps-upper",        "Upper trapezius",               "Trapézio superior",                 "back"),
    ("traps-middle",       "Middle trapezius",              "Trapézio médio",                    "back"),
    ("traps-lower",        "Lower trapezius",               "Trapézio inferior",                 "back"),
    ("rhomboids",          "Rhomboids",                     "Romboides",                         "back"),
    ("erectors",           "Spinal erectors",               "Eretores da espinha",               "back"),
    ("delt-front",         "Anterior deltoid",              "Deltoide anterior",                 "shoulders"),
    ("delt-side",          "Lateral deltoid",               "Deltoide lateral",                  "shoulders"),
    ("delt-rear",          "Posterior deltoid",             "Deltoide posterior",                "shoulders"),
    ("rotator-cuff",       "Rotator cuff",                  "Manguito rotador",                  "shoulders"),
    ("biceps",             "Biceps",                        "Bíceps",                            "arms"),
    ("brachialis",         "Brachialis",                    "Braquial",                          "arms"),
    ("coracobrachialis",   "Coracobrachialis",              "Coracobraquial",                    "arms"),
    ("triceps",            "Triceps",                       "Tríceps",                           "arms"),
    ("brachioradialis",    "Brachioradialis",               "Braquiorradial",                    "forearms"),
    ("forearm-flexors",    "Forearm flexors",               "Flexores do antebraço",             "forearms"),
    ("forearm-extensors",  "Forearm extensors",             "Extensores do antebraço",           "forearms"),
    ("hand",               "Hand muscles",                  "Músculos da mão",                   "forearms"),
    ("scm",                "Sternocleidomastoid",           "Esternocleidomastoideo",            "neck"),
    ("neck-back",          "Splenius and neck extensors",   "Esplênios e extensores do pescoço", "neck"),
    ("neck-deep",          "Scalenes and hyoid muscles",    "Escalenos e hióideos",              "neck"),
    ("glutes",             "Gluteus maximus",               "Glúteo máximo",                     "hips"),
    ("glute-med",          "Gluteus medius and minimus",    "Glúteo médio e mínimo",             "hips"),
    ("tfl",                "Tensor fasciae latae",          "Tensor da fáscia lata",             "hips"),
    ("hip-flexors",        "Iliopsoas",                     "Iliopsoas",                         "hips"),
    ("hip-rotators",       "Deep hip rotators",             "Rotadores profundos do quadril",    "hips"),
    ("quads",              "Quadriceps",                    "Quadríceps",                        "thighs"),
    ("sartorius",          "Sartorius",                     "Sartório",                          "thighs"),
    ("adductors",          "Adductors",                     "Adutores",                          "thighs"),
    ("hamstrings",         "Hamstrings",                    "Posteriores da coxa",               "thighs"),
    ("gastrocnemius",      "Gastrocnemius",                 "Gastrocnêmio",                      "lower-legs"),
    ("soleus",             "Soleus",                        "Sóleo",                             "lower-legs"),
    ("tibialis",           "Tibialis anterior and extensors", "Tibial anterior e extensores",    "lower-legs"),
    ("fibularis",          "Fibularis",                     "Fibulares",                         "lower-legs"),
    ("deep-calf",          "Deep calf flexors",             "Flexores profundos da perna",       "lower-legs"),
    ("foot",               "Foot muscles",                  "Músculos do pé",                    "lower-legs"),
]

# --------------------------------------------------------------------------
# Fit regions (src/fit.js). Every group belongs to exactly one; every region becomes a morph
# target whose weight scales the hypertrophy of its groups. Limbs have one region per side,
# because tape measures have a side.
# --------------------------------------------------------------------------
REGIONS = [
    # id          English                     Portuguese            sided  groups
    ("upperarm",  "Upper arm",                "Braço",              True,  ["biceps", "brachialis", "coracobrachialis", "triceps"]),
    ("forearm",   "Forearm",                  "Antebraço",          True,  ["brachioradialis", "forearm-flexors", "forearm-extensors", "hand"]),
    ("thigh",     "Thigh",                    "Coxa",               True,  ["quads", "sartorius", "adductors", "hamstrings"]),
    ("calf",      "Lower leg",                "Perna",              True,  ["gastrocnemius", "soleus", "tibialis", "fibularis", "deep-calf", "foot"]),
    ("shoulders", "Shoulders",                "Ombros",             False, ["delt-front", "delt-side", "delt-rear", "rotator-cuff"]),
    ("chest",     "Chest",                    "Peitoral",           False, ["chest-upper", "chest-middle", "chest-lower", "serratus"]),
    ("back",      "Back",                     "Costas",             False, ["lats", "teres-major", "traps-middle", "traps-lower", "rhomboids",
                                                                            "erectors"]),
    ("neck",      "Neck and upper trapezius", "Pescoço e trapézio", False, ["traps-upper", "scm", "neck-back", "neck-deep"]),
    ("core",      "Abdomen",                  "Abdome",             False, ["abs", "obliques", "intercostals"]),
    ("hips",      "Hips and glutes",          "Quadril e glúteos",  False, ["glutes", "glute-med", "tfl", "hip-flexors", "hip-rotators"]),
]


def region_ids() -> list[str]:
    """Region ids in morph-target order: limbs per side (left, right), then the trunk."""
    out = []
    for rid, _en, _pt, sided, _groups in REGIONS:
        out += [f"{rid}_l", f"{rid}_r"] if sided else [rid]
    return out


def region_of(group: str | None, side: str | None) -> str | None:
    """Region of a muscle from its group and side (None for a group outside every region)."""
    for rid, _en, _pt, sided, groups in REGIONS:
        if group in groups:
            return f"{rid}_{side}" if sided else rid
    return None


# --------------------------------------------------------------------------
# Muscles (right side): id, BodyParts3D sources, English label, Portuguese label, group.
# A source is a concept name, or "=FJxxxx" for one mesh file (when the name is wrong).
# --------------------------------------------------------------------------
MUSCLES = [
    # trunk — chest and thoracic wall
    ("pectoralis-major-clavicular", ["clavicular part of right pectoralis major"], "Pectoralis major (clavicular part)", "Peitoral maior (parte clavicular)", "chest-upper"),
    ("pectoralis-major-sternocostal", ["sternocostal part of right pectoralis major"], "Pectoralis major (sternocostal part)", "Peitoral maior (parte esternocostal)", "chest-middle"),
    ("pectoralis-major-abdominal", ["abdominal part of right pectoralis major"], "Pectoralis major (abdominal part)", "Peitoral maior (parte abdominal)", "chest-lower"),
    ("pectoralis-minor", ["right pectoralis minor"], "Pectoralis minor", "Peitoral menor", "chest-middle"),
    ("serratus-anterior", ["right serratus anterior"], "Serratus anterior", "Serrátil anterior", "serratus"),
    ("external-intercostals", ["=FJ1451"], "External intercostals", "Intercostais externos", "intercostals"),
    # abdomen (rectus abdominis is cut out of the external oblique, split.py)
    ("external-oblique", ["right external oblique"], "External oblique", "Oblíquo externo do abdome", "obliques"),
    # shoulder
    ("deltoid-clavicular", ["clavicular part of right deltoid"], "Deltoid (clavicular part)", "Deltoide (parte clavicular)", "delt-front"),
    ("deltoid-acromial", ["acromial part of right deltoid"], "Deltoid (acromial part)", "Deltoide (parte acromial)", "delt-side"),
    ("deltoid-spinal", ["spinal part of right deltoid"], "Deltoid (spinal part)", "Deltoide (parte espinal)", "delt-rear"),
    ("supraspinatus", ["right supraspinatus"], "Supraspinatus", "Supraespinal", "rotator-cuff"),
    ("infraspinatus", ["right infraspinatus muscle"], "Infraspinatus", "Infraespinal", "rotator-cuff"),
    ("teres-minor", ["right teres minor"], "Teres minor", "Redondo menor", "rotator-cuff"),
    ("subscapularis", ["right subscapularis"], "Subscapularis", "Subescapular", "rotator-cuff"),
    ("teres-major", ["right teres major"], "Teres major", "Redondo maior", "teres-major"),
    # back
    ("trapezius-descending", ["descending part of right trapezius"], "Trapezius (descending part)", "Trapézio (parte descendente)", "traps-upper"),
    ("trapezius-transverse", ["transverse part of right trapezius"], "Trapezius (transverse part)", "Trapézio (parte transversa)", "traps-middle"),
    ("trapezius-ascending", ["ascending part of right trapezius"], "Trapezius (ascending part)", "Trapézio (parte ascendente)", "traps-lower"),
    ("rhomboid-major", ["right rhomboid major"], "Rhomboid major", "Romboide maior", "rhomboids"),
    ("rhomboid-minor", ["right rhomboid minor"], "Rhomboid minor", "Romboide menor", "rhomboids"),
    ("iliocostalis-lumborum", ["right iliocostalis lumborum"], "Iliocostalis lumborum", "Iliocostal do lombo", "erectors"),
    ("iliocostalis-thoracis", ["right iliocostalis thoracis"], "Iliocostalis thoracis", "Iliocostal do tórax", "erectors"),
    ("iliocostalis-cervicis", ["right iliocostalis cervicis"], "Iliocostalis cervicis", "Iliocostal do pescoço", "erectors"),
    ("longissimus-thoracis", ["right longissimus thoracis"], "Longissimus thoracis", "Longuíssimo do tórax", "erectors"),
    ("longissimus-cervicis", ["right longissimus cervicis"], "Longissimus cervicis", "Longuíssimo do pescoço", "erectors"),
    ("spinalis-thoracis", ["right spinalis thoracis"], "Spinalis thoracis", "Espinal do tórax", "erectors"),
    ("semispinalis-thoracis", ["right semispinalis thoracis"], "Semispinalis thoracis", "Semiespinal do tórax", "erectors"),
    # neck
    ("sternocleidomastoid", ["right sternocleidomastoid"], "Sternocleidomastoid", "Esternocleidomastoideo", "scm"),
    ("levator-scapulae", ["right levator scapulae"], "Levator scapulae", "Levantador da escápula", "neck-back"),
    ("splenius-capitis", ["right splenius capitis"], "Splenius capitis", "Esplênio da cabeça", "neck-back"),
    ("splenius-cervicis", ["right splenius cervicis"], "Splenius cervicis", "Esplênio do pescoço", "neck-back"),
    ("semispinalis-capitis", ["right semispinalis capitis"], "Semispinalis capitis", "Semiespinal da cabeça", "neck-back"),
    ("semispinalis-cervicis", ["right semispinalis cervicis"], "Semispinalis cervicis", "Semiespinal do pescoço", "neck-back"),
    ("longissimus-capitis", ["right longissimus capitis"], "Longissimus capitis", "Longuíssimo da cabeça", "neck-back"),
    ("scalenus-anterior", ["right scalenus anterior"], "Anterior scalene", "Escaleno anterior", "neck-deep"),
    ("scalenus-medius", ["right scalenus medius"], "Middle scalene", "Escaleno médio", "neck-deep"),
    ("scalenus-posterior", ["right scalenus posterior"], "Posterior scalene", "Escaleno posterior", "neck-deep"),
    ("sternohyoid", ["right sternohyoid"], "Sternohyoid", "Esterno-hióideo", "neck-deep"),
    ("sternothyroid", ["right sternothyroid"], "Sternothyroid", "Esternotireóideo", "neck-deep"),
    ("omohyoid", ["right omohyoid"], "Omohyoid", "Omo-hióideo", "neck-deep"),
    ("thyrohyoid", ["right thyrohyoid"], "Thyrohyoid", "Tíreo-hióideo", "neck-deep"),
    ("digastric", ["right digastric"], "Digastric", "Digástrico", "neck-deep"),
    ("mylohyoid", ["right mylohyoid"], "Mylohyoid", "Milo-hióideo", "neck-deep"),
    ("stylohyoid", ["right stylohyoid"], "Stylohyoid", "Estilo-hióideo", "neck-deep"),
    # arm
    ("biceps-long-head", ["long head of right biceps brachii"], "Biceps brachii (long head)", "Bíceps braquial (cabeça longa)", "biceps"),
    ("biceps-short-head", ["short head of right biceps brachii"], "Biceps brachii (short head)", "Bíceps braquial (cabeça curta)", "biceps"),
    ("brachialis", ["right brachialis"], "Brachialis", "Braquial", "brachialis"),
    ("coracobrachialis", ["right coracobrachialis"], "Coracobrachialis", "Coracobraquial", "coracobrachialis"),
    ("triceps-long-head", ["long head of right triceps brachii"], "Triceps brachii (long head)", "Tríceps braquial (cabeça longa)", "triceps"),
    ("triceps-lateral-head", ["lateral head of right triceps brachii"], "Triceps brachii (lateral head)", "Tríceps braquial (cabeça lateral)", "triceps"),
    ("triceps-medial-head", ["medial head of right triceps brachii"], "Triceps brachii (medial head)", "Tríceps braquial (cabeça medial)", "triceps"),
    ("anconeus", ["right anconeus"], "Anconeus", "Ancôneo", "triceps"),
    # forearm
    ("brachioradialis", ["right brachioradialis"], "Brachioradialis", "Braquiorradial", "brachioradialis"),
    ("pronator-teres", ["humeral head of right pronator teres", "ulnar head of right pronator teres"], "Pronator teres", "Pronador redondo", "forearm-flexors"),
    ("flexor-carpi-radialis", ["right flexor carpi radialis"], "Flexor carpi radialis", "Flexor radial do carpo", "forearm-flexors"),
    ("palmaris-longus", ["right palmaris longus"], "Palmaris longus", "Palmar longo", "forearm-flexors"),
    ("flexor-carpi-ulnaris", ["humeral head of right flexor carpi ulnaris", "ulnar head of right flexor carpi ulnaris"], "Flexor carpi ulnaris", "Flexor ulnar do carpo", "forearm-flexors"),
    ("flexor-digitorum-superficialis", ["right flexor digitorum superficialis"], "Flexor digitorum superficialis", "Flexor superficial dos dedos", "forearm-flexors"),
    ("flexor-digitorum-profundus", ["right flexor digitorum profundus"], "Flexor digitorum profundus", "Flexor profundo dos dedos", "forearm-flexors"),
    ("flexor-pollicis-longus", ["right flexor pollicis longus"], "Flexor pollicis longus", "Flexor longo do polegar", "forearm-flexors"),
    ("pronator-quadratus", ["right pronator quadratus"], "Pronator quadratus", "Pronador quadrado", "forearm-flexors"),
    ("extensor-carpi-radialis-longus", ["right extensor carpi radialis longus"], "Extensor carpi radialis longus", "Extensor radial longo do carpo", "forearm-extensors"),
    ("extensor-carpi-radialis-brevis", ["right extensor carpi radialis brevis"], "Extensor carpi radialis brevis", "Extensor radial curto do carpo", "forearm-extensors"),
    ("extensor-digitorum", ["right extensor digitorum"], "Extensor digitorum", "Extensor dos dedos", "forearm-extensors"),
    ("extensor-digiti-minimi", ["right extensor digiti minimi"], "Extensor digiti minimi", "Extensor do dedo mínimo", "forearm-extensors"),
    ("extensor-carpi-ulnaris", ["right extensor carpi ulnaris"], "Extensor carpi ulnaris", "Extensor ulnar do carpo", "forearm-extensors"),
    ("abductor-pollicis-longus", ["right abductor pollicis longus"], "Abductor pollicis longus", "Abdutor longo do polegar", "forearm-extensors"),
    ("extensor-pollicis-brevis", ["right extensor pollicis brevis"], "Extensor pollicis brevis", "Extensor curto do polegar", "forearm-extensors"),
    ("extensor-pollicis-longus", ["right extensor pollicis longus"], "Extensor pollicis longus", "Extensor longo do polegar", "forearm-extensors"),
    ("extensor-indicis", ["right extensor indicis"], "Extensor indicis", "Extensor do indicador", "forearm-extensors"),
    ("supinator", ["right supinator"], "Supinator", "Supinador", "forearm-extensors"),
    # hand
    ("abductor-pollicis-brevis", ["right abductor pollicis brevis"], "Abductor pollicis brevis", "Abdutor curto do polegar", "hand"),
    # BodyParts3D swaps the side in the name of FJ1469 ("left flexor pollicis brevis" lies in the
    # right hand): it is taken by file, or each side would join one piece of each hand
    # (body.check_sides catches that)
    ("flexor-pollicis-brevis", ["=FJ1469", "superficial head of right flexor pollicis brevis"], "Flexor pollicis brevis", "Flexor curto do polegar", "hand"),
    ("opponens-pollicis", ["right opponens pollicis"], "Opponens pollicis", "Oponente do polegar", "hand"),
    ("adductor-pollicis", ["oblique head of right adductor pollicis", "transverse head of right adductor pollicis"], "Adductor pollicis", "Adutor do polegar", "hand"),
    ("abductor-digiti-minimi-hand", ["abductor digiti minimi of right hand"], "Abductor digiti minimi (hand)", "Abdutor do dedo mínimo", "hand"),
    ("flexor-digiti-minimi-hand", ["flexor digiti minimi brevis of right hand"], "Flexor digiti minimi brevis (hand)", "Flexor curto do dedo mínimo", "hand"),
    ("opponens-digiti-minimi-hand", ["opponens digiti minimi of right hand"], "Opponens digiti minimi", "Oponente do dedo mínimo", "hand"),
    ("dorsal-interossei-hand", ["set of dorsal interossei of right hand"], "Dorsal interossei (hand)", "Interósseos dorsais", "hand"),
    ("palmar-interossei-hand", ["set of palmar interossei of right hand"], "Palmar interossei", "Interósseos palmares", "hand"),
    ("lumbricals-hand", ["set of lumbricals of right hand"], "Lumbricals (hand)", "Lumbricais", "hand"),
    # hip
    ("gluteus-maximus", ["right gluteus maximus"], "Gluteus maximus", "Glúteo máximo", "glutes"),
    ("gluteus-medius", ["right gluteus medius"], "Gluteus medius", "Glúteo médio", "glute-med"),
    ("gluteus-minimus", ["right gluteus minimus"], "Gluteus minimus", "Glúteo mínimo", "glute-med"),
    ("tensor-fasciae-latae", ["right tensor fasciae latae"], "Tensor fasciae latae", "Tensor da fáscia lata", "tfl"),
    ("psoas-major", ["right psoas major"], "Psoas major", "Psoas maior", "hip-flexors"),
    ("iliacus", ["right iliacus"], "Iliacus", "Ilíaco", "hip-flexors"),
    ("piriformis", ["right piriformis"], "Piriformis", "Piriforme", "hip-rotators"),
    ("gemellus-superior", ["right gemellus superior"], "Superior gemellus", "Gêmeo superior", "hip-rotators"),
    ("gemellus-inferior", ["right gemellus inferior"], "Inferior gemellus", "Gêmeo inferior", "hip-rotators"),
    ("obturator-internus", ["right obturator internus"], "Obturator internus", "Obturador interno", "hip-rotators"),
    ("obturator-externus", ["right obturator externus"], "Obturator externus", "Obturador externo", "hip-rotators"),
    ("quadratus-femoris", ["right quadratus femoris"], "Quadratus femoris", "Quadrado femoral", "hip-rotators"),
    # thigh
    ("rectus-femoris", ["right rectus femoris"], "Rectus femoris", "Reto femoral", "quads"),
    ("vastus-lateralis", ["right vastus lateralis"], "Vastus lateralis", "Vasto lateral", "quads"),
    ("vastus-medialis", ["right vastus medialis"], "Vastus medialis", "Vasto medial", "quads"),
    ("vastus-intermedius", ["right vastus intermedius"], "Vastus intermedius", "Vasto intermédio", "quads"),
    ("sartorius", ["right sartorius"], "Sartorius", "Sartório", "sartorius"),
    ("gracilis", ["right gracilis"], "Gracilis", "Grácil", "adductors"),
    ("pectineus", ["right pectineus"], "Pectineus", "Pectíneo", "adductors"),
    ("adductor-longus", ["right adductor longus"], "Adductor longus", "Adutor longo", "adductors"),
    ("adductor-brevis", ["right adductor brevis"], "Adductor brevis", "Adutor curto", "adductors"),
    ("adductor-magnus", ["right adductor magnus"], "Adductor magnus", "Adutor magno", "adductors"),
    ("adductor-minimus", ["right adductor minimus"], "Adductor minimus", "Adutor mínimo", "adductors"),
    ("biceps-femoris-long-head", ["long head of right biceps femoris"], "Biceps femoris (long head)", "Bíceps femoral (cabeça longa)", "hamstrings"),
    ("biceps-femoris-short-head", ["short head of right biceps femoris"], "Biceps femoris (short head)", "Bíceps femoral (cabeça curta)", "hamstrings"),
    ("semitendinosus", ["right semitendinosus"], "Semitendinosus", "Semitendíneo", "hamstrings"),
    ("semimembranosus", ["right semimembranosus"], "Semimembranosus", "Semimembranáceo", "hamstrings"),
    # lower leg
    ("gastrocnemius-medial", ["medial head of right gastrocnemius"], "Gastrocnemius (medial head)", "Gastrocnêmio (cabeça medial)", "gastrocnemius"),
    ("gastrocnemius-lateral", ["lateral head of right gastrocnemius"], "Gastrocnemius (lateral head)", "Gastrocnêmio (cabeça lateral)", "gastrocnemius"),
    ("plantaris", ["right plantaris"], "Plantaris", "Plantar", "gastrocnemius"),
    ("soleus", ["right soleus"], "Soleus", "Sóleo", "soleus"),
    ("tibialis-anterior", ["right tibialis anterior"], "Tibialis anterior", "Tibial anterior", "tibialis"),
    ("extensor-digitorum-longus", ["right extensor digitorum longus"], "Extensor digitorum longus", "Extensor longo dos dedos", "tibialis"),
    ("extensor-hallucis-longus", ["right extensor hallucis longus"], "Extensor hallucis longus", "Extensor longo do hálux", "tibialis"),
    ("fibularis-tertius", ["right fibularis tertius"], "Fibularis tertius", "Fibular terceiro", "tibialis"),
    ("fibularis-longus", ["right fibularis longus"], "Fibularis longus", "Fibular longo", "fibularis"),
    ("fibularis-brevis", ["right fibularis brevis"], "Fibularis brevis", "Fibular curto", "fibularis"),
    ("tibialis-posterior", ["right tibialis posterior"], "Tibialis posterior", "Tibial posterior", "deep-calf"),
    ("flexor-digitorum-longus", ["right flexor digitorum longus"], "Flexor digitorum longus", "Flexor longo dos dedos", "deep-calf"),
    ("flexor-hallucis-longus", ["right flexor hallucis longus"], "Flexor hallucis longus", "Flexor longo do hálux", "deep-calf"),
    ("popliteus", ["right popliteus"], "Popliteus", "Poplíteo", "deep-calf"),
    # foot
    ("extensor-hallucis-brevis", ["right extensor hallucis brevis"], "Extensor hallucis brevis", "Extensor curto do hálux", "foot"),
    ("abductor-hallucis", ["right abductor hallucis"], "Abductor hallucis", "Abdutor do hálux", "foot"),
    ("flexor-digitorum-brevis", ["right flexor digitorum brevis"], "Flexor digitorum brevis", "Flexor curto dos dedos", "foot"),
    ("quadratus-plantae", ["right flexor accessorius"], "Quadratus plantae", "Quadrado plantar", "foot"),
    ("abductor-digiti-minimi-foot", ["abductor digiti minimi of right foot"], "Abductor digiti minimi (foot)", "Abdutor do dedo mínimo do pé", "foot"),
    ("flexor-digiti-minimi-foot", ["flexor digiti minimi brevis of right foot"], "Flexor digiti minimi brevis (foot)", "Flexor curto do dedo mínimo do pé", "foot"),
    ("opponens-digiti-minimi-foot", ["opponens digiti minimi of right foot"], "Opponens digiti minimi (foot)", "Oponente do dedo mínimo do pé", "foot"),
    ("flexor-hallucis-brevis", ["lateral head of right flexor hallucis brevis", "medial head of right flexor hallucis brevis"], "Flexor hallucis brevis", "Flexor curto do hálux", "foot"),
    ("adductor-hallucis", ["oblique head of right adductor hallucis", "transverse head of right adductor hallucis"], "Adductor hallucis", "Adutor do hálux", "foot"),
    ("lumbricals-foot", ["first lumbrical of right foot", "second lumbrical of right foot", "third lumbrical of right foot", "fourth lumbrical of right foot"], "Lumbricals (foot)", "Lumbricais do pé", "foot"),
    ("plantar-interossei-foot", ["first plantar interosseous of right foot", "second plantar interosseous of right foot", "third plantar interosseous of right foot"], "Plantar interossei", "Interósseos plantares", "foot"),
]

# Built by the pipeline (absent from BodyParts3D 4.0) — geometry in split.py / synth.py.
SYNTHETIC = [
    # id                  English             Portuguese            group
    ("rectus-abdominis",  "Rectus abdominis", "Reto do abdome",     "abs"),
    ("latissimus-dorsi",  "Latissimus dorsi", "Latíssimo do dorso", "lats"),
]

# Visible connective tissue, never activated. `sided` False = a single midline part.
TISSUES = [
    # id                  sources                    English                        Portuguese            sided
    ("linea-alba",        ["linea alba"],            "Linea alba",                  "Linha alba",         False),
    ("iliotibial-tract",  ["right iliotibial tract"], "Iliotibial tract",           "Trato iliotibial",   True),
    ("calcaneal-tendon",  ["right calcaneal tendon"], "Calcaneal (Achilles) tendon", "Tendão do calcâneo", True),
]
SYNTHETIC_TISSUES = [
    ("patellar-ligament", "Patellar ligament", "Ligamento da patela"),
]

# --------------------------------------------------------------------------
# Skeleton: FMA name → rig segment rules. The first rule that matches wins.
# --------------------------------------------------------------------------
BONE_SEGMENTS = [
    # (regex on the FMA name, segment; {side} becomes l/r)
    (r"first metacarpal", "thumb1_{side}"),
    (r"proximal phalanx of (right|left) thumb", "thumb2_{side}"),
    (r"distal phalanx of (right|left) thumb", "thumb3_{side}"),
    (r"proximal phalanx of (right|left) (index|middle|ring|little) finger", "{finger}1_{side}"),
    (r"middle phalanx of (right|left) (index|middle|ring|little) finger", "{finger}2_{side}"),
    (r"distal phalanx of (right|left) (index|middle|ring|little) finger", "{finger}3_{side}"),
    (r"phalanx of (right|left) .*toe|sesamoid bone of (right|left) foot", "toes_{side}"),
    (r"metacarpal|capitate|hamate|lunate|pisiform|scaphoid|trapezium|trapezoid|triquetral", "hand_{side}"),
    (r"metatarsal|calcaneus|cuboid|cuneiform bone|navicular|talus", "foot_{side}"),
    (r"tibia|fibula", "shin_{side}"),
    (r"femur|patella", "thigh_{side}"),
    (r"radius|ulna", "forearm_{side}"),
    (r"humerus", "upperarm_{side}"),
    (r"clavicle|scapula", "shoulder_{side}"),
    (r"hip bone|sacrum", "pelvis"),
    (r"(third|fourth|fifth) lumbar vertebra|disk of (fourth|fifth) lumbar", "spine_lower"),
    (r"(first|second) lumbar vertebra|disk of (first|second|third) lumbar", "spine_upper"),
    (r"thoracic vertebra|rib|costal cartilage|sternum|manubrium|xiphoid", "chest"),
    (r"(third|fourth|fifth|sixth|seventh) cervical vertebra|disk of (third|fourth|fifth|sixth|seventh) cervical|hyoid", "neck"),
    (r"atlas|axis|disk of axis|frontal bone|parietal|occipital bone|temporal bone|sphenoid|ethmoid|zygomatic|maxilla|"
     r"nasal bone|lacrimal bone|palatine|vomer|nasal concha|mandible|tooth", "head"),
]

BONE_EXCLUDE = r"intervertebral disk$"  # the generic disk duplicates a named one

# Viscera are never drawn, but they form the "core" on which the hypertrophy stacks (morph.py)
# — without them the whole abdomen would inflate from the spine.
VISCERA = [
    r"stomach", r"colon$", r"jejunum", r"ileum", r"duodenum", r"rectum", r"urinary bladder",
    r"spleen", r"kidney", r"pancreas$", r"hepatovenous segment", r"caudate lobe of liver",
    r"wall of (right |left )?(ventricle|atrium)", r"cavity of (right |left )?(ventricle|atrium)",
    r"esophagus", r"trachea", r"bronchial tree", r"main bronchus",
]

# --------------------------------------------------------------------------
# Training groups: the coarse vocabulary of gym programming (one name per "muscle group" of a
# typical exercise catalog) → anatomical groups or muscles, with weights. A weight is the
# fraction of the activation given to the training group, because a training group usually
# spans more than one anatomical structure. The English names are the codes of the Trace
# catalog (where this vocabulary comes from) and the Portuguese names are its current labels;
# both resolve in the viewer.
# --------------------------------------------------------------------------
TRAINING_GROUPS = [
    # id                     English               Portuguese               targets
    ("abductors",            "Abductors",          "Abdutores",             {"glute-med": 1, "tfl": 1}),
    ("abs",                  "Abs",                "Abdômen",               {"abs": 1}),
    ("adductors",            "Adductors",          "Adutores",              {"adductors": 1}),
    ("anterior-deltoids",    "Anterior Deltoids",  "Deltoide anterior",     {"delt-front": 1}),
    ("biceps",               "Biceps",             "Bíceps",                {"biceps": 1}),
    ("brachialis",           "Brachialis",         "Braquial",              {"brachialis": 1, "brachioradialis": 0.5}),
    ("calves",               "Calves",             "Panturrilhas",          {"gastrocnemius": 1, "soleus": 1}),
    ("chest",                "Chest",              "Peitoral",              {"chest-upper": 1, "chest-middle": 1, "chest-lower": 1}),
    ("forearms",             "Forearms",           "Antebraços",            {"forearm-flexors": 1, "forearm-extensors": 1, "brachioradialis": 1}),
    ("glutes",               "Glutes",             "Glúteos",               {"glutes": 1, "glute-med": 0.5}),
    ("hamstrings",           "Hamstrings",         "Posteriores da coxa",   {"hamstrings": 1}),
    ("hip-flexors",          "Hip Flexors",        "Flexores do quadril",   {"hip-flexors": 1, "rectus-femoris": 0.6, "sartorius": 0.6, "tfl": 0.5}),
    ("lateral-deltoids",     "Lateral Deltoids",   "Deltoide lateral",      {"delt-side": 1}),
    ("lats",                 "Lats",               "Dorsais",               {"lats": 1, "teres-major": 1}),
    ("lower-back",           "Lower Back",         "Lombar",                {"erectors": 1}),
    ("lower-chest",          "Lower Chest",        "Peitoral inferior",     {"chest-lower": 1}),
    ("neck",                 "Neck",               "Pescoço",               {"scm": 1, "neck-back": 1, "neck-deep": 1}),
    ("obliques",             "Obliques",           "Oblíquos",              {"obliques": 1}),
    ("posterior-deltoids",   "Posterior Deltoids", "Deltoide posterior",    {"delt-rear": 1}),
    ("quadriceps",           "Quadriceps",         "Quadríceps",            {"quads": 1}),
    ("rotator-cuff",         "Rotator Cuff",       "Manguito rotador",      {"rotator-cuff": 1}),
    ("trapezius",            "Trapezius",          "Trapézio",              {"traps-upper": 1, "traps-middle": 1, "traps-lower": 1}),
    ("triceps",              "Triceps",            "Tríceps",               {"triceps": 1}),
    ("upper-back",           "Upper Back",         "Parte alta das costas", {"rhomboids": 1, "traps-middle": 1, "traps-lower": 0.8, "teres-major": 0.6}),
    ("upper-chest",          "Upper Chest",        "Peitoral superior",     {"chest-upper": 1}),
]


def left_name(name: str) -> str:
    return name.replace("right", "left")


def label_of(base: str) -> str:
    """English label of a muscle or tissue by id (for the parts the pipeline builds itself)."""
    labels = {mid: en for mid, _srcs, en, _pt, _group in MUSCLES}
    labels.update({mid: en for mid, en, _pt, _group in SYNTHETIC})
    labels.update({tid: en for tid, _srcs, en, _pt, _sided in TISSUES})
    labels.update({tid: en for tid, en, _pt in SYNTHETIC_TISSUES})
    return labels[base]


def check() -> None:
    """Fail loudly if a name is missing from the catalog or ids and groups do not close."""
    import json
    import pathlib
    with open(pathlib.Path(__file__).resolve().parent.parent / "catalog" / "bp3d-elements.json", encoding="utf-8") as fh:
        rows = json.load(fh)
    names = {r["name"] for r in rows}
    files = {r["file"] for r in rows}
    group_ids = {g for g, *_rest in GROUPS}
    area_ids = {a for a, *_rest in AREAS}
    ids = set()
    problems = []
    for mid, srcs, en, pt, group in MUSCLES:
        if mid in ids:
            problems.append(f"duplicate id: {mid}")
        ids.add(mid)
        if group not in group_ids:
            problems.append(f"{mid}: unknown group {group}")
        if not en or not pt:
            problems.append(f"{mid}: missing label")
        for s in srcs:
            if s.startswith("="):
                if s[1:] not in files:
                    problems.append(f"{mid}: file {s} does not exist")
            elif s not in names:
                problems.append(f"{mid}: '{s}' does not exist")
            elif "right" in s and left_name(s) not in names:
                problems.append(f"{mid}: no left side for '{s}'")
    for mid, _en, _pt, group in SYNTHETIC:
        ids.add(mid)
        if group not in group_ids:
            problems.append(f"{mid}: unknown group {group}")
    for gid, _en, _pt, area in GROUPS:
        if area not in area_ids:
            problems.append(f"group {gid}: unknown area {area}")
    used = {g for *_x, g in MUSCLES} | {g for *_x, g in SYNTHETIC}
    for g in group_ids - used:
        problems.append(f"group without muscle: {g}")
    seen_training = set()
    for tid, en, _pt, targets in TRAINING_GROUPS:
        if tid in seen_training:
            problems.append(f"duplicate training group: {tid}")
        seen_training.add(tid)
        for t in targets:
            if t not in group_ids and t not in ids:
                problems.append(f"training group '{en}': unknown target {t}")
    in_regions = [g for *_x, groups in REGIONS for g in groups]
    for g in group_ids:
        if in_regions.count(g) != 1:
            problems.append(f"group {g} is in {in_regions.count(g)} regions (must be in one)")
    for g in set(in_regions) - group_ids:
        problems.append(f"region with unknown group: {g}")
    if problems:
        raise SystemExit("\n".join(problems))
    print(f"ok: {len(MUSCLES) + len(SYNTHETIC)} muscles per side, {len(GROUPS)} groups, "
          f"{len(TRAINING_GROUPS)} training groups")


if __name__ == "__main__":
    check()
