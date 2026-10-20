'use client';
import {AlertCircle,Check,Loader2,X} from 'lucide-react';
export function ErrorBox({message}:{message?:string}){return message?<div className="error" role="alert"><AlertCircle size={16}/>{message}</div>:null;}
export function Loading(){return <div className="loading"><Loader2 className="spin" size={22}/><span>Loading your workspace…</span></div>;}
export function Badge({value}:{value:string}){return <span className={'badge '+value.toLowerCase().replaceAll(' ','-')}>{value==='Accepted'&&<Check size={12}/>} {value}</span>;}
export function Empty({title,children}:{title:string,children?:React.ReactNode}){return <div className="empty"><div className="empty-mark">⌘</div><h3>{title}</h3><p>{children}</p></div>;}
export function Modal({title,children,onClose}:{title:string,children:React.ReactNode,onClose:()=>void}){return <div className="modal-shade" onClick={onClose}><section className="modal" role="dialog" aria-modal="true" aria-label={title} onClick={e=>e.stopPropagation()}><div className="section-head"><h2>{title}</h2><button className="icon" onClick={onClose} aria-label="Close"><X size={20}/></button></div>{children}</section></div>;}
export function DataTable({columns,rows}:{columns:string[],rows:unknown[][]}){return <div className="table-scroll"><table className="data-table"><thead><tr>{columns.map((c,i)=><th key={i}>{c}</th>)}</tr></thead><tbody>{rows.map((r,i)=><tr key={i}>{r.map((c,j)=><td key={j}>{c===null?<em className="muted">NULL</em>:String(c)}</td>)}</tr>)}</tbody></table>{!rows.length&&<div className="muted pad">No rows returned.</div>}</div>;}
