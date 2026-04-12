# CosmosCurves - Bug Audit Report

Generated: 2026-04-12
Last Updated: 2026-04-12

## Summary

| Severity | Total | Fixed | Remaining |
|----------|-------|-------|-----------|
| CRITICAL | 8 | 8 | 0 |
| HIGH | 12 | 8 | 4 |
| MEDIUM | 25 | 5 | 20 |
| LOW | 10 | 1 | 9 |
| **TOTAL** | **55** | **22** | **33** |

---

## CRITICAL BUGS

### 1. `fit_curves()` Missing Return Statement and `winning_curve` Key
- **File:** `backend/curve_fitting.py:83`
- **Issue:** Function builds `results` dict but NEVER returns it (returns `None` implicitly). Also never computes `winning_curve` key.
- **Impact:** `main.py:762` crashes with `TypeError` (NoneType), then `KeyError: 'winning_curve'`
- **Status:** ✅ FIXED

### 2. Division by Zero in Progress Calculation
- **File:** `backend/main.py:673`
- **Code:** `state.progress = 0.1 + (0.3 * (i/len(filenames)))`
- **Issue:** If `len(filenames) == 0`, division by zero
- **Impact:** ZeroDivisionError crashes pipeline
- **Status:** ✅ FIXED (added empty directory check before processing)

### 3. Unchecked Image Decode in Pipeline
- **File:** `backend/main.py:707-709`
- **Code:**
  ```python
  np_arr = np.fromfile(selected_frames[0]["filepath"], dtype=np.uint8)
  img = cv2.imdecode(np_arr, cv2.IMREAD_COLOR)
  frame_height, frame_width = img.shape[:2]  # Crashes if img is None
  ```
- **Issue:** No check for `if img is None`
- **Impact:** AttributeError crash if frame file is corrupted
- **Status:** ✅ FIXED (added null check after cv2.imdecode)

### 4. Memory Leak: Preview Interval Never Cleared
- **File:** `phone-pwa/src/App.jsx:622-650`
- **Issue:** `startPreviewLoop()` creates interval but no cleanup when:
  - Component unmounts
  - Screen changes to 'record'
  - User navigates back from TEST_DETECTION
- **Impact:** Continuous API calls, battery drain, memory leak
- **Status:** ✅ FIXED (added cleanup useEffect for all intervals/timeouts)

### 5. Thread Safety: Global Sessions Dict
- **File:** `backend/session.py:100`
- **Code:** `sessions: Dict[str, SessionState] = {}`
- **Issue:** Global dict accessed without locks in concurrent FastAPI requests
- **Impact:** Dict corruption, race conditions, crashes in production
- **Status:** ✅ FIXED (added threading.RLock and thread-safe accessors)

### 6. Race Condition in Session Cleanup
- **File:** `backend/session.py:130-132`
- **Code:** `for sid in expired_ids: del sessions[sid]`
- **Issue:** No lock protection, can crash if another thread iterating
- **Impact:** KeyError crash during cleanup
- **Status:** ✅ FIXED (cleanup now runs inside lock)

### 7. Race Condition in Session Lookup
- **File:** `backend/session.py:103-117`
- **Issue:** Dictionary iteration not thread-safe in concurrent requests
- **Impact:** Potential KeyError or missed sessions
- **Status:** ✅ FIXED (all session access now uses RLock)

### 8. Division by Zero Risk in Coordinate Transform
- **File:** `backend/main.py:747-748`
- **Code:** `x_cm = ... / state.px_per_cm`
- **Issue:** If `state.px_per_cm == 0` or `None`, division by zero
- **Impact:** ZeroDivisionError or TypeError
- **Status:** ✅ FIXED (added px_per_cm validation before use)

---

## HIGH SEVERITY BUGS

### 9. Silent API Failures in Phone PWA
- **File:** `phone-pwa/src/App.jsx:104-120`
- **Code:** `if (!sessionCode) return;` - silent return
- **Issue:** API function returns `undefined` silently if no sessionCode
- **Impact:** Calling code doesn't know API failed, crashes on undefined response
- **Status:** ✅ FIXED (now throws Error when no sessionCode)

### 10. Stale Closure in Polling Effect
- **File:** `laptop-pwa/src/App.jsx:78-116`
- **Issue:** `setInterval` callback captures stale `screen` value
- **Impact:** Screen transitions missed, wrong branches execute
- **Status:** ✅ FIXED (added screenRef and use ref.current in callback)

### 11. Frame Index Mismatch Between Phone and Backend
- **File:** `phone-pwa/src/App.jsx:712` vs `backend/main.py:1029`
- **Issue:** Phone sends queue position as index, backend expects file index
- **Impact:** If frames dropped, frame preview shows wrong images
- **Status:** UNFIXED

### 12. Race Condition in Stage Advancement
- **File:** `phone-pwa/src/App.jsx:497-500`
- **Issue:** `setTimeout` auto-advances stage after 2s, can fire after screen change
- **Impact:** Stage skipping, stale state updates
- **Status:** ✅ FIXED (timeout tracked with ref, uses functional setState to check current stage)

### 13. Missing Null Checks in drawMarkerOverlay
- **File:** `phone-pwa/src/App.jsx:503-557`
- **Code:** `const { marker1, marker2, y_axis } = result;` then `marker1.x_px`
- **Issue:** No validation that result has required fields
- **Impact:** TypeError crash on incomplete API response
- **Status:** ✅ FIXED (added validation for result, marker1, marker2, y_axis, and pixel coords)

### 14. Multiple Simultaneous API Calls Race
- **File:** `phone-pwa/src/App.jsx:453-620`
- **Issue:** Multiple async functions can be called simultaneously without mutex
- **Impact:** Stage advancement despite user cancellation
- **Status:** UNFIXED

### 15. markerPreview.annotated_image Not Validated
- **File:** `phone-pwa/src/App.jsx:975-1027`
- **Issue:** API response set directly without structure validation
- **Impact:** Silent failure if backend returns error without annotated_image
- **Status:** UNFIXED

### 16. Camera Error Traps User on Screen
- **File:** `phone-pwa/src/App.jsx:122-144`
- **Issue:** Error only updates `setupPrompt`, screen already set to 'camera'
- **Impact:** User trapped on broken camera screen, can't go back
- **Status:** UNFIXED

### 17. Recording Interval Not Cleared on Unmount
- **File:** `phone-pwa/src/App.jsx:709-726`
- **Issue:** `recordIntervalRef.current` never cleared if component unmounts during recording
- **Impact:** Memory leak, CPU usage continues
- **Status:** ✅ FIXED (cleanup useEffect clears recordIntervalRef and camera stream)

### 18. Empty Frames Directory Not Checked
- **File:** `backend/main.py:556-557`
- **Issue:** No check for `len(filenames) == 0` before processing loop
- **Impact:** Silent failure with misleading logs, then division by zero
- **Status:** ✅ FIXED (see issue #2 - same fix)

### 19. FPS Zero Check Missing in Debug Endpoint
- **File:** `backend/main.py:1146-1147`
- **Code:** `fps = cap.get(cv2.CAP_PROP_FPS)` then uses directly
- **Issue:** If video has unknown FPS, returns 0
- **Impact:** Sets frame position incorrectly
- **Status:** UNFIXED

### 20. Stale Closure in startPreviewLoop
- **File:** `phone-pwa/src/App.jsx:622-650`
- **Issue:** Callback captures `isRecording`, `screen`, `markerResult` at creation time
- **Impact:** Overlay shows stale marker positions after re-detection
- **Status:** ✅ FIXED (added refs for isRecording, screen, setupStage, markerResult)

---

## MEDIUM SEVERITY BUGS

### 21. Area Boundary Conditions Use Exclusive Range
- **File:** `backend/detection.py:324,385,118`
- **Code:** `if 2 < area < 2000:` (exclusive)
- **Issue:** Areas exactly at boundary are rejected
- **Impact:** Legitimate balls at exact boundary sizes missed
- **Status:** UNFIXED

### 22. Session Code Not Normalized to Uppercase
- **File:** `laptop-pwa/src/App.jsx:34`
- **Issue:** localStorage value not uppercased, backend does uppercase lookup
- **Impact:** Session lookup may fail with lowercase codes
- **Status:** ✅ FIXED (added .toUpperCase() when reading from localStorage)

### 23. Retry Logic Inconsistent
- **File:** `phone-pwa/src/App.jsx:436-451`
- **Issue:** `retrySmallBall()` and `retryBigBall()` don't clear overlay canvas
- **Impact:** Stale marker overlay visible during ball sampling
- **Status:** UNFIXED

### 24. No Way to Restart After Reaching READY Stage
- **File:** `phone-pwa/src/App.jsx:758-975`
- **Issue:** Once READY reached, no button to restart calibration
- **Impact:** User must hard-refresh browser to restart
- **Status:** UNFIXED

### 25. Frame Count Undefined on Record Screen
- **File:** `laptop-pwa/src/App.jsx:92`
- **Issue:** Accesses `res.frame_count` but backend only returns it when status='recording'
- **Impact:** Frame count stuck at 0 if timing is off
- **Status:** UNFIXED

### 26. Progress Values Not Validated
- **File:** `laptop-pwa/src/App.jsx:97`
- **Issue:** No validation that progress is between 0 and 1
- **Impact:** Invalid CSS values (NaN%)
- **Status:** ✅ FIXED (added Math.max(0, Math.min(1, ...)) validation)

### 27. Error Not Cleared When Retrying
- **File:** `laptop-pwa/src/App.jsx:620`
- **Issue:** Error state not cleared when clicking retry
- **Impact:** Old error message shown temporarily
- **Status:** ✅ FIXED (setError('') added to retry and loadResults)

### 28. Silent Catch in Preview Loop
- **File:** `phone-pwa/src/App.jsx:624-649`
- **Code:** `catch (e) { }` - empty catch block
- **Issue:** Network errors silently ignored
- **Impact:** Stale preview data, no error feedback
- **Status:** ✅ FIXED (added console.warn for debugging)

### 29. Box Dragging Constraint Math Issue
- **File:** `phone-pwa/src/App.jsx:362-380`
- **Issue:** Offset applied after constraint, box can move outside canvas edge
- **Impact:** Box partially outside visible canvas
- **Status:** UNFIXED

### 30. Missing markerDistance Input Validation
- **File:** `phone-pwa/src/App.jsx:453-483`
- **Issue:** User can enter non-numeric, negative, zero values
- **Impact:** NaN sent to backend, unclear errors
- **Status:** ✅ FIXED (added validation for NaN, <= 0, > 1000)

### 31. Debug Poll References Stale sessionCode
- **File:** `laptop-pwa/src/App.jsx:158`
- **Issue:** If sessionCode becomes null, polling continues with null
- **Impact:** API called with null session code
- **Status:** UNFIXED

### 32. debugInfo State Missing Fields Initially
- **File:** `laptop-pwa/src/App.jsx:48`
- **Issue:** Missing `small_ball_bgr`, `big_ball_bgr`, `px_per_cm` in default state
- **Impact:** Potential TypeError on first render
- **Status:** UNFIXED

### 33. Incorrect Area Calculation Precision
- **File:** `backend/main.py:575`
- **Code:** Uses `3.14159` instead of `math.pi`
- **Issue:** Minor precision loss in area calculation
- **Impact:** Slightly inaccurate area values
- **Status:** UNFIXED

### 34. Race Condition in Frame Count Update
- **File:** `backend/main.py:507-513`
- **Issue:** `state.frame_count += 1` without lock protection
- **Impact:** Incorrect frame count in concurrent uploads
- **Status:** UNFIXED

### 35. Off-by-One Index Parsing
- **File:** `backend/main.py:1002`
- **Code:** `int(f.split("_")[1].split(".")[0])`
- **Issue:** If filename format wrong, IndexError
- **Impact:** Crash on unexpected filename format
- **Status:** UNFIXED

### 36. State Mutation Without Lock
- **File:** `backend/main.py:527-550`
- **Issue:** `state.progress` updated without lock while other endpoints read it
- **Impact:** Inconsistent progress values
- **Status:** UNFIXED

### 37. Fallback to Hough Not Documented
- **File:** `backend/main.py:404-410`
- **Issue:** If big_ball_color not set, silently uses Hough circles
- **Impact:** Different detection methods, confusing for users
- **Status:** UNFIXED

### 38. Silent Network Failures in Laptop Polling
- **File:** `laptop-pwa/src/App.jsx:109-111`
- **Issue:** API failures logged but no user feedback
- **Impact:** User doesn't know session lost
- **Status:** UNFIXED

### 39. Box Position Not Reset Between Stages
- **File:** `phone-pwa/src/App.jsx:78-80`
- **Issue:** Box size/position persists between MARKER_TAP and SMALL_BALL_TAP
- **Impact:** Inconsistent sampling behavior
- **Status:** UNFIXED

### 40. Event Listener Not Removed on Unmount (Camera)
- **File:** `phone-pwa/src/App.jsx:146-150`
- **Issue:** Camera stream continues after component unmounts
- **Impact:** Battery drain, camera indicator stays on
- **Status:** UNFIXED

### 41. Race Between Cleanup and State Update
- **File:** `laptop-pwa/src/App.jsx:95-108`
- **Issue:** 800ms timeout before loadResults, old interval could still execute
- **Impact:** Brief progress bar flashing, double loadResults call
- **Status:** UNFIXED

### 42. setRuns Called with Array Mutation
- **File:** `laptop-pwa/src/App.jsx:226`
- **Code:** `.reverse()` mutates original array
- **Issue:** Bad practice, could cause bugs if array reused
- **Status:** UNFIXED

### 43. Grid Reference Unsafe Access
- **File:** `laptop-pwa/src/App.jsx:741`
- **Issue:** `gridRef.current?.runColors` accessed before grid init
- **Impact:** Brief flash of wrong color
- **Status:** UNFIXED

### 44. Circular Dependency in useCallback
- **File:** `phone-pwa/src/App.jsx:257-288`
- **Issue:** `sampleColorFromBox` and `drawBoxOverlay` have circular deps
- **Impact:** Potential unnecessary re-renders
- **Status:** UNFIXED

### 45. Config URL Disclosure
- **File:** `phone-pwa/src/config.js:14-17`
- **Issue:** Logs API base URL if DEV mode enabled
- **Impact:** Minor security info disclosure
- **Status:** UNFIXED

---

## LOW SEVERITY BUGS

### 46. Unused Import: CircleDot
- **File:** `phone-pwa/src/App.jsx:6`
- **Issue:** `CircleDot` imported but never used
- **Impact:** Slight bundle size increase
- **Status:** ✅ FIXED (removed from imports)

### 47. Misleading Debug Log
- **File:** `phone-pwa/src/App.jsx:227`
- **Issue:** `capturedImage.length` always 8 (string 'captured')
- **Impact:** Debug info incorrect
- **Status:** UNFIXED

### 48. Missing Debouncing on Box Position
- **File:** `phone-pwa/src/App.jsx:291-296`
- **Issue:** `sampleColorFromBox()` called on every position change
- **Impact:** Potential jank on slower devices
- **Status:** UNFIXED

### 49. Hidden Canvas Still Allocated
- **File:** `phone-pwa/src/App.jsx:1140`
- **Issue:** Hidden canvas with `display: none` still in memory
- **Impact:** Minor memory overhead
- **Status:** UNFIXED

### 50. No Loading State During Camera Startup
- **File:** `phone-pwa/src/App.jsx:122-144`
- **Issue:** 1-5s delay before onloadedmetadata, user sees blank
- **Impact:** User thinks app frozen
- **Status:** UNFIXED

### 51. Conditional Indentation Inconsistency
- **File:** `backend/main.py:965, 1108`
- **Issue:** Extra space in indent
- **Impact:** Style inconsistency only
- **Status:** UNFIXED

### 52. Missing Error Boundary
- **File:** `phone-pwa/src/App.jsx`
- **Issue:** No error boundary component
- **Impact:** Unhandled crashes show white screen
- **Status:** UNFIXED

### 53. Tooltip Visibility Not Toggled Off
- **File:** `laptop-pwa/src/grid.js:289-317`
- **Issue:** Tooltip might persist when leaving canvas
- **Impact:** Minor UI glitch
- **Status:** UNFIXED

### 54. Using alert() Instead of Error State
- **File:** `laptop-pwa/src/App.jsx:208-210`
- **Issue:** Uses native `alert()` for errors
- **Impact:** Poor UX, blocks UI
- **Status:** UNFIXED

### 55. captureCanvas Not Cleared Between Stages
- **File:** `phone-pwa/src/App.jsx:152-163`
- **Issue:** Old data in canvas memory briefly
- **Impact:** Minor memory inefficiency
- **Status:** UNFIXED

---

## Fix Priority

### Immediate (Before Next Deploy)
1. Fix `curve_fitting.py` - add return and winning_curve
2. Add thread locks around sessions dict
3. Add null check after cv2.imdecode
4. Add empty directory check before processing
5. Add cleanup useEffect for preview interval

### High Priority
6. Validate API responses before using
7. Fix silent API failures
8. Fix stale closures in polling
9. Add null checks in drawMarkerOverlay
10. Clear recording interval on unmount

### Medium Priority
11. Normalize session codes to uppercase
12. Add input validation for markerDistance
13. Fix retry logic consistency
14. Add progress value validation
15. Add restart button for calibration
