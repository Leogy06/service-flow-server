import { z } from "zod";
import { userService } from "@/services/user.service.js";
const createUserSchema = z.object({
    email: z.string().email(),
    name: z.string().min(1),
});
export const userController = {
    async list(_, res, next) {
        try {
            const users = await userService.list();
            res.json(users);
        }
        catch (err) {
            next(err);
        }
    },
    async getById(req, res, next) {
        try {
            const user = await userService.getById(Number(req.params.id));
            res.json(user);
        }
        catch (err) {
            next(err);
        }
    },
    async create(req, res, next) {
        try {
            const parsed = createUserSchema.parse(req.body);
            const user = await userService.create(parsed);
            res.status(201).json(user);
        }
        catch (err) {
            next(err);
        }
    },
};
//# sourceMappingURL=user.controller.js.map