import ResetForm from '../../../features/auth/reset-form.jsx'

export default async function ResetPage({ params }) {
  const { token } = await params
  return <ResetForm token={token} />
}
