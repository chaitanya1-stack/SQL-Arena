import {z} from 'zod';
export const dialects=['postgres','mysql'] as const;
export type Dialect=typeof dialects[number];
const sql=z.string().min(1).max(150000);
const pair=z.object({postgres:sql,mysql:sql}).strict();
export const resultSchema=z.object({columns:z.array(z.object({name:z.string(),type:z.enum(['text','number','boolean','date'])})).min(1).max(30),rows:z.array(z.array(z.union([z.string(),z.number().finite(),z.boolean(),z.null()]))).max(1000)});
export const questionSchema=z.object({
  id:z.string().regex(/^q[0-9]{3,6}$/),slug:z.string().regex(/^[a-z0-9-]+$/),title:z.string().min(5).max(140),
  difficulty:z.enum(['Easy','Medium','Hard']),topics:z.array(z.string().min(1).max(60)).min(1).max(10),
  companies:z.array(z.string().min(1).max(70)).max(5),attribution:z.literal('Company-style simulation'),
  statement:z.string().min(30).max(12000),explanation:z.string().min(10).max(12000),
  constraints:z.array(z.string()).min(1).max(20),edgeCases:z.array(z.string()).min(1).max(20),
  hints:z.array(z.string()).max(5),minutes:z.number().int().min(3).max(120),
  ordered:z.boolean(),tolerance:z.number().min(0).max(0.01).default(0),
  schema:pair,solutions:pair,
  tables:z.array(z.object({name:z.string(),columns:z.array(z.string()),rows:z.array(z.array(z.union([z.string(),z.number(),z.null()])))})).min(1).max(20),
  tests:z.array(z.object({id:z.string(),hidden:z.boolean(),setup:pair,expected:resultSchema})).min(3).max(12)
}).strict().superRefine((q,ctx)=>{
  if(q.tests.filter(t=>!t.hidden).length!==1)ctx.addIssue({code:'custom',message:'Exactly one sample dataset is required'});
  if(q.tests.filter(t=>t.hidden).length<2)ctx.addIssue({code:'custom',message:'At least two hidden datasets are required'});
  for(const t of q.tests)if(t.expected.rows.some(r=>r.length!==t.expected.columns.length))ctx.addIssue({code:'custom',message:`Column count mismatch in ${t.id}`});
  if(new Set(q.tests.map(t=>t.id)).size!==q.tests.length)ctx.addIssue({code:'custom',message:'Duplicate dataset IDs'});
});
export type Question=z.infer<typeof questionSchema>;
export type Result=z.infer<typeof resultSchema>;
export function publicQuestion(q:Question){const {solutions,tests,explanation,...rest}=q;return {...rest,tests:tests.filter(t=>!t.hidden).map(({id,expected})=>({id,expected}))};}
export const verdicts=['Accepted','Wrong Answer','Syntax Error','Runtime Error','Time Limit Exceeded','Resource Limit Exceeded','Unsupported Query','Internal Judge Error'] as const;
export type Verdict=typeof verdicts[number];
