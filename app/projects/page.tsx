export const dynamic = 'force-dynamic'

import { FileType } from '@/data/projectsData'
import { publicFiles } from 'lib/archive/public'
import { genPageMetadata } from 'app/seo'
import ListLayoutWithFiles from '@/components/layouts/ListLayoutWithFiles'
import { IconType } from 'react-icons'

const FILES_PER_PAGE = 5

export const metadata = genPageMetadata({ title: 'Projects' })

interface ProjectFile {
  icon: IconType
  title: string
  description: string
  type: FileType
  tags?: string[]
  url?: string
}

export default async function Projects() {
  const files = await publicFiles()
  const pageNumber = 1
  const totalPages = Math.ceil(files.length / FILES_PER_PAGE)
  const initialDisplayFiles = files.slice(0, FILES_PER_PAGE * pageNumber)
  const pagination = {
    currentPage: pageNumber,
    totalPages: totalPages,
  }

  return (
    <ListLayoutWithFiles
      files={files}
      initialDisplayFiles={initialDisplayFiles}
      pagination={pagination}
      title="Files"
    />
  )
}
