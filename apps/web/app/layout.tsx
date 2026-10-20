import type {Metadata} from 'next';
import './style.css';
export const metadata:Metadata={title:'SQL Arena — Practice with purpose',description:'Real SQL practice, company-style assessments, and a clear view of your progress.'};
export default function Layout({children}:{children:React.ReactNode}){return <html lang="en"><body>{children}</body></html>;}
