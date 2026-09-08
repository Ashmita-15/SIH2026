import * as recommendationService from '../services/recommendationService.js';
import { sendError } from '../services/errors.js';

/** HTTP in front of recommendationService. No review logic lives here. */

const context = (req) => ({ actorId: req.user.id, io: req.io });

export const listRecommendations = async (req, res) => {
    try { res.json(await recommendationService.listRecommendations(req.query, context(req))); }
    catch (e) { sendError(res, e); }
};

export const getRecommendation = async (req, res) => {
    try { res.json(await recommendationService.getRecommendation(req.params.id, context(req))); }
    catch (e) { sendError(res, e); }
};

/** The only path by which an agent proposal becomes real work. */
export const approveRecommendation = async (req, res) => {
    try { res.json(await recommendationService.approveRecommendation(req.params.id, req.body, context(req))); }
    catch (e) { sendError(res, e); }
};

export const rejectRecommendation = async (req, res) => {
    try { res.json(await recommendationService.rejectRecommendation(req.params.id, req.body, context(req))); }
    catch (e) { sendError(res, e); }
};
