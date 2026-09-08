import * as referralService from '../services/referralService.js';
import { sendError } from '../services/errors.js';

/**
 * HTTP in front of referralService, and nothing else.
 *
 * No business rule lives here. The coordination agent added later calls the
 * same service functions directly, so any check written in this file would
 * simply not apply to it.
 */

/** Everything the service needs to know about the caller. */
const context = (req) => ({ actorId: req.user.id, io: req.io });

export const createReferral = async (req, res) => {
    try {
        const referral = await referralService.createReferral(req.body, context(req));
        res.status(201).json(referral);
    } catch (e) {
        sendError(res, e);
    }
};

export const getReferral = async (req, res) => {
    try {
        const referral = await referralService.getReferralById(req.params.id, context(req));
        res.json({
            referral,
            // Saves every client from keeping its own copy of the state machine.
            allowedTransitions: referralService.allowedTransitions(referral.status)
        });
    } catch (e) {
        sendError(res, e);
    }
};

export const listReferrals = async (req, res) => {
    try {
        const referrals = await referralService.listReferrals(req.query, context(req));
        res.json(referrals);
    } catch (e) {
        sendError(res, e);
    }
};

export const updateReferralStatus = async (req, res) => {
    try {
        const { status, ...payload } = req.body;
        if (!status) return res.status(400).json({ message: 'status is required' });
        const referral = await referralService.transitionReferral(req.params.id, status, payload, context(req));
        res.json(referral);
    } catch (e) {
        sendError(res, e);
    }
};

/** Named entry point for closing the loop. Same service call underneath. */
export const completeReferral = async (req, res) => {
    try {
        const referral = await referralService.completeReferral(
            req.params.id, req.body.counterReferral, context(req), req.body.note
        );
        res.json(referral);
    } catch (e) {
        sendError(res, e);
    }
};
