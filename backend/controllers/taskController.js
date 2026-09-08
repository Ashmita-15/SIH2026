import * as taskService from '../services/taskService.js';
import { sendError } from '../services/errors.js';

/** HTTP in front of taskService. Scoping decisions all live in the service. */

const context = (req) => ({ actorId: req.user.id, io: req.io });

export const listTasks = async (req, res) => {
    try { res.json(await taskService.listTasks(req.query, context(req))); }
    catch (e) { sendError(res, e); }
};

export const getWorklist = async (req, res) => {
    try { res.json(await taskService.getWorklist(context(req))); }
    catch (e) { sendError(res, e); }
};

export const getTask = async (req, res) => {
    try { res.json(await taskService.getTask(req.params.id, context(req))); }
    catch (e) { sendError(res, e); }
};

export const completeTask = async (req, res) => {
    try { res.json(await taskService.completeTask(req.params.id, req.body, context(req))); }
    catch (e) { sendError(res, e); }
};
