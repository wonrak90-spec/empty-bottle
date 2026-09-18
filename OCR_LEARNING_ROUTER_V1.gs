/**
 * OCR Learning Store V1 - router adapter
 * Add this file to the CURRENT Apps Script project together with OCR_LEARNING_STORE_V1.gs.
 *
 * Call only AFTER the existing session authentication has resolved `actor`.
 * These helpers return {handled:false} for every unrelated action so existing behavior is untouched.
 */

function routeOcrLearningGetV1_(action, params, actor) {
  action = String(action || '');
  params = params || {};
  if (action === 'ocrLearningInfo') {
    return { handled: true, result: ocrLearningInfoV1_() };
  }
  if (action === 'ocrLearningList') {
    return { handled: true, result: listOcrLearningV1_(params, actor) };
  }
  if (action === 'ocrDatasetVersions') {
    return { handled: true, result: listOcrDatasetVersionsV1_(actor) };
  }
  if (action === 'ocrLearningMetrics') {
    return { handled: true, result: ocrLearningMetricsV1_(params, actor) };
  }
  if (action === 'ocrDatasetManifest') {
    return { handled: true, result: exportOcrDatasetManifestV1_(params, actor) };
  }
  return { handled: false };
}

function routeOcrLearningPostV1_(action, payload, actor) {
  action = String(action || '');
  payload = payload || {};
  if (action === 'ocrLearningSave') {
    return { handled: true, result: saveOcrLearningV1_(payload, actor) };
  }
  if (action === 'ocrLearningVerify') {
    return { handled: true, result: verifyOcrLearningV1_(payload, actor) };
  }
  if (action === 'ocrDatasetCreate') {
    return { handled: true, result: createOcrDatasetVersionV1_(payload, actor) };
  }
  return { handled: false };
}
