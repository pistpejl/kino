# Enhetstest av Openjutsu-ifyllnaden (ingen GPU/ComfyUI behovs): KINO_STUB=1 python test_openjutsu.py
import os, json, sys
os.environ.setdefault("KINO_STUB", "1"); os.environ.setdefault("KINO_STUB_AUDIO", "1")
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import kino_colab_server as s
src = json.load(open(os.path.join(os.path.dirname(__file__), "openjutsu", "simple.api.json")))
g = s.oj_fill(src, "kino_x.mp4", "kino_x_artist.png", 5, "720p", 42)
assert g["2"]["inputs"]["image"] == "kino_x_artist.png"
assert g["5"]["inputs"]["video"] == "kino_x.mp4" and g["5"]["inputs"]["frame_load_cap"] == 120 and g["5"]["inputs"]["skip_first_frames"] == 0
p = g["11"]["inputs"]; assert p["resolution"] == "736p" and p["seed"] == 42 and p["clip_seconds"] == 5
assert g["15"]["inputs"]["unet_name"] == s.OJ_MODELS["unet"] and g["19"]["inputs"]["clip_name"] == s.OJ_MODELS["te"]
assert "17" not in g and g["18"]["inputs"]["model"] == ["16", 0]          # attention-noden forbikopplad (T4)
assert "68" not in g and "72" not in g and "no_lip_sync" not in p          # lipsync pa: No lip-sync-noderna borta
assert g["5_soundtrack"]["class_type"] == "H3SoundtrackOrSilence" and g["6"]["inputs"]["audio"] == ["5_soundtrack", 0]
g2 = s.oj_fill(src, "v.mp4", "i.png", 30, "480p", 1, lipsync=False, bypass_attention=False)
assert g2["11"]["inputs"]["clip_seconds"] == 6 and g2["11"]["inputs"]["resolution"] == "480p" and "68" in g2 and "17" in g2
assert src["5"]["inputs"]["video"] == ""                                   # kallan oforandrad
for gg in (g, g2):
    for nid, n in gg.items():
        for k, v in n["inputs"].items():
            if s._is_link(v): assert v[0] in gg, (nid, k, v)
json.dumps(g)
print("openjutsu: alla tester ok", len(g), "noder")
