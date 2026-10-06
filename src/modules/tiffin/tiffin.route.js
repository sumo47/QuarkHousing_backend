// src/modules/tiffin/tiffin.routes.js
const express = require('express');
const router = express.Router();
const tiffinController = require('./tiffin.controller');
const validate = require('../../middlewares/validate.middleware');
const { requireAuth, restrictTo } = require('../../middlewares/auth.middleware');
const { requireActiveMembership } = require('../../middlewares/membership.middleware');
const { uploadMedia } = require('../../middlewares/upload.middleware');
const {
    createTiffinServiceSchema,
    updateTiffinServiceSchema,
    toggleStatusSchema,
    createPlanSchema,
    upsertMenuSchema
} = require('./tiffin.schema');

// NOTE: Tiffin approval (admin approve/reject) isn't built yet — deferred
// until a proper `admin` module is designed. For now, manually flip
// approval_status to 'APPROVED' directly in the DB to test/unblock a listing:
//   UPDATE tiffin_services SET approval_status = 'APPROVED' WHERE id = <id>;

// Actions that add/change what a vendor can sell (creating a listing, editing
// it, adding a plan, updating the menu) require an active membership -- see
// src/modules/membership/. Pausing (status toggle) and deleting your own
// listing are NOT gated -- a vendor should always be able to take their own
// listing down, membership or not.

// ---------------------------------------------------------------------------
// VENDOR: My services (fixed path, must come before '/:id')
// ---------------------------------------------------------------------------
router.get('/my-services', requireAuth, restrictTo('VENDOR'), tiffinController.getMyTiffinServices);

router.post(
    '/',
    requireAuth,
    restrictTo('VENDOR'),
    requireActiveMembership,
    uploadMedia.array('tiffin_images', 10),
    validate(createTiffinServiceSchema),
    tiffinController.createTiffinService
);

router.patch(
    '/:id',
    requireAuth,
    restrictTo('VENDOR'),
    requireActiveMembership,
    uploadMedia.array('tiffin_images', 10),
    validate(updateTiffinServiceSchema),
    tiffinController.updateTiffinService
);

router.patch(
    '/:id/status',
    requireAuth,
    restrictTo('VENDOR'),
    validate(toggleStatusSchema),
    tiffinController.toggleTiffinStatus
);

router.delete('/:id', requireAuth, restrictTo('VENDOR'), tiffinController.deleteTiffinService);

// --- Subscription Plans (customer-facing meal plans, e.g. Monthly/Weekly) ---
router.post('/:id/plans', requireAuth, restrictTo('VENDOR'), requireActiveMembership, validate(createPlanSchema), tiffinController.createPlan);
router.get('/:id/plans', tiffinController.getPlans); // public

// --- Daily Menu ---
router.put('/:id/menu', requireAuth, restrictTo('VENDOR'), requireActiveMembership, validate(upsertMenuSchema), tiffinController.upsertDailyMenu);
router.get('/:id/menu', tiffinController.getDailyMenu); // public

// ---------------------------------------------------------------------------
// PUBLIC: Browse & Detail (declared last since '/:id' is a catch-all)
// ---------------------------------------------------------------------------
router.get('/', tiffinController.searchTiffinServices);
router.get('/:id', tiffinController.getTiffinServiceDetails);

module.exports = router;