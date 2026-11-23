torch 2.15.0, threads 8, mps available True
26s reel11: decode 90 ms, envelopes@60fps 162 ms (1560 frames)
180s it_had_to_be_you: decode 376 ms, envelopes@60fps 1149 ms (10773 frames)

| model | device | load_s | clip | first_call_s | warm_median_s | warm_runs_s | x_realtime | same_as_cpu |
|---|---|---|---|---|---|---|---|---|
| final0 | cpu | 0.33 | 26s reel11 | 0.31 | 0.30 | 0.30, 0.28, 0.31 | 87x | - |
| final0 | cpu | 0.33 | 180s it_had_to_be_you | 2.92 | 2.37 | 2.41, 2.36, 2.37 | 76x | - |
| final0 | mps | 0.49 | 26s reel11 | 0.34 | 0.09 | 0.09, 0.10, 0.09 | 281x | yes |
| final0 | mps | 0.49 | 180s it_had_to_be_you | 0.86 | 0.70 | 0.70, 0.69, 0.70 | 258x | yes |
| small0 | cpu | 0.05 | 26s reel11 | 0.29 | 0.22 | 0.24, 0.22, 0.21 | 117x | - |
| small0 | cpu | 0.05 | 180s it_had_to_be_you | 1.74 | 1.73 | 1.73, 1.73, 1.71 | 104x | - |
| small0 | mps | 0.17 | 26s reel11 | 0.44 | 0.07 | 0.07, 0.07, 0.07 | 376x | yes |
| small0 | mps | 0.17 | 180s it_had_to_be_you | 0.64 | 0.51 | 0.51, 0.51, 0.51 | 351x | yes |
