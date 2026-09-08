import JoinForm from '../../../features/auth/join-form.jsx'

export default async function JoinPage({ params }) {
  const { token } = await params
  return <JoinForm token={token} />
}
