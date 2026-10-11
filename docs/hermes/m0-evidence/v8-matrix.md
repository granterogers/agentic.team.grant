| Id | Check | Verdict | Environment | Evidence |
|---|---|---|---|---|
| V8-2 | the key's account total did not move across the live window (a stricter test than V8-3: it also holds only if the office was idle on the same key) | **PASS** | live | usage 2.781556615 -> 2.781556615 across the live calls (delta 0); the office shares this key, so a non-zero delta is not attributable without V8-3 |
| V8-3 | every generation this harness made is, per the provider's own generation record, to an allowlisted model and cost exactly zero | **PASS** | live | 7 of 7 successful calls had a generation id (streamed and non-streamed, direct and through Hermes); total_cost values: 0; models: nvidia/nemotron-3-super-120b-a12b-20230311:free; upstream_inference_cost: 0 |
