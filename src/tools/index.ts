// Export all tool handlers
export { addEntryHandler } from './add-entry.js';
export { logFoodHandler, type LogFoodParams } from './log-food.js';
export { listEntriesHandler } from './list-entries.js';
export { updateEntryHandler } from './update-entry.js';
export { deleteEntryHandler } from './delete-entry.js';
export { registerUserHandler } from './register-user.js';
export { revokeUserHandler } from './revoke-user.js';
export { getProfile } from './get-profile.js';
export { updateProfile } from './update-profile.js';
export { getProfileHistory } from './get-profile-history.js';
export { addBodyMeasurementHandler } from './add-body-measurement.js';
export { listBodyMeasurementsHandler } from './list-body-measurements.js';
export { addProgressPhotoHandler } from './add-progress-photo.js';
export { listProgressPhotosHandler } from './list-progress-photos.js';
export { compareProgressHandler } from './compare-progress.js';
export { setUserPreferencesHandler } from './set-user-preferences.js';
export { getUserPreferencesHandler } from './get-user-preferences.js';

// Re-export types and utilities for convenience
export * from '../types/index.js';
export * from '../utils/responses.js';
