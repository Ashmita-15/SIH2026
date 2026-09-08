import * as healthWorkerService from '../services/healthWorkerService.js';
import { dangerRuleCatalogue } from '../services/dangerSigns.js';
import { sendError } from '../services/errors.js';

/** HTTP in front of healthWorkerService. No scoping decision is made here. */

const context = (req) => ({ actorId: req.user.id, io: req.io });

export const getMe = async (req, res) => {
    try {
        res.json(await healthWorkerService.getWorkerProfile(context(req)));
    } catch (e) {
        sendError(res, e);
    }
};

export const listPatients = async (req, res) => {
    try {
        res.json(await healthWorkerService.listPatients(req.query, context(req)));
    } catch (e) {
        sendError(res, e);
    }
};

export const getPatient = async (req, res) => {
    try {
        res.json(await healthWorkerService.getPatient(req.params.id, context(req)));
    } catch (e) {
        sendError(res, e);
    }
};

export const registerPatient = async (req, res) => {
    try {
        res.status(201).json(await healthWorkerService.registerPatient(req.body, context(req)));
    } catch (e) {
        sendError(res, e);
    }
};

export const createEncounter = async (req, res) => {
    try {
        const result = await healthWorkerService.createEncounter(req.params.patientId, req.body, context(req));
        res.status(201).json(result);
    } catch (e) {
        sendError(res, e);
    }
};

export const listEncounters = async (req, res) => {
    try {
        res.json(await healthWorkerService.listEncounters(req.params.patientId, context(req)));
    } catch (e) {
        sendError(res, e);
    }
};

/** The thresholds, so the interface never keeps its own copy of them. */
export const getDangerRules = (req, res) => res.json(dangerRuleCatalogue());

export const requestConsultation = async (req, res) => {
    try {
        const appt = await healthWorkerService.requestAssistedConsultation(req.params.patientId, req.body, context(req));
        res.status(201).json(appt);
    } catch (e) { sendError(res, e); }
};

export const listConsultations = async (req, res) => {
    try { res.json(await healthWorkerService.listAssistedConsultations(req.params.patientId, context(req))); }
    catch (e) { sendError(res, e); }
};

export const openCarePlan = async (req, res) => {
    try {
        const plan = await healthWorkerService.openCarePlan(req.params.patientId, req.body, context(req));
        res.status(201).json(plan);
    } catch (e) { sendError(res, e); }
};

export const listCarePlans = async (req, res) => {
    try { res.json(await healthWorkerService.listCarePlans(req.params.patientId, context(req))); }
    catch (e) { sendError(res, e); }
};
