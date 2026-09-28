import { requestBody } from '../../src/agents/request.ts'
import { readRetraction } from '../../src/agents/retraction.ts'

const s = 'Actually scrap that and add a task to ring the venue instead.'
console.log('retraction', JSON.stringify(readRetraction(s)))
console.log('body', JSON.stringify(requestBody(s)))
console.log('body2', JSON.stringify(requestBody(s.replace(/^\s*actually[,\s]+/i, ''))))
