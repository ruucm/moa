import ProjectView from '../../../components/project-view.jsx'

const dec = (s) => { try { return decodeURIComponent(s) } catch { return s } }

export default async function ProjectPage({ params }) {
  const { slug } = await params
  return <ProjectView slug={dec(slug)} docSlug={null} />
}
