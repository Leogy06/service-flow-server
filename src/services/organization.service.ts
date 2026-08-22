import { prisma } from '@/lib/prisma.js';
import { Prisma } from '@/generated/prisma/client.js';

export const organizationService = {
    async  create(input: Prisma.OrganizationCreateInput) {
        const newOrg = await prisma.organization.create({ data: input });
    
        return newOrg;
    },

    async list() {
        return await prisma.organization.findMany();
    }
};