import Admin from '@/components/admin/Admin'
export const dynamic = 'force-dynamic'
export const metadata = { title: 'Archive administration', robots: { index: false, follow: false } }
export default function Page() {
  return <Admin />
}
