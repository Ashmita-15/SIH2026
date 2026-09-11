import * as service from '../services/diagnosticService.js';

/** Identity comes from the token; the body never names the actor. */
const context = (req) => ({ actorId: req.user?.id });

const send = (res, e) => {
    const status = e?.status || (e?.name === 'CastError' ? 404 : 500);
    res.status(status).json({ message: status === 500 ? 'Something went wrong' : e.message });
};

export const create = async (req, res) => {
    try { res.status(201).json(await service.createRequest(req.body, context(req))); }
    catch (e) { send(res, e); }
};

export const list = async (req, res) => {
    try { res.json(await service.listRequests(req.query, context(req))); }
    catch (e) { send(res, e); }
};

export const getOne = async (req, res) => {
    try { res.json(await service.getRequest(req.params.id, context(req))); }
    catch (e) { send(res, e); }
};

export const updateStatus = async (req, res) => {
    try { res.json(await service.updateStatus(req.params.id, req.body, context(req))); }
    catch (e) { send(res, e); }
};
