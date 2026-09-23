import { Router } from 'express'
import { prisma } from '../lib/prisma.js'
export const infrastructureRouter = Router()
infrastructureRouter.get('/', async (_req,res)=>{
  const rows = await prisma.infrastructureIndicator.findMany({ include:{ entity:true, source:true }, orderBy:{ lastSeen:'desc' } })
  res.json(rows)
})
