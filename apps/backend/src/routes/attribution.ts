import { Router } from 'express'
import { prisma } from '../lib/prisma.js'
export const attributionRouter = Router()
attributionRouter.get('/', async (_req,res)=>{
  const rows = await prisma.attributionLink.findMany({ include:{ actor:{ include:{ identifiers:true } } }, orderBy:{ confidence:'desc' } })
  res.json(rows)
})
attributionRouter.get('/actors', async (_req,res)=>{
  const rows = await prisma.entity.findMany({ include:{ identifiers:true, personaProfiles:true, infrastructureIndicators:true }, orderBy:{ confidence:'desc' } })
  res.json(rows)
})
