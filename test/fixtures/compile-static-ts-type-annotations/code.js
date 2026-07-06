import styled from 'styled-components'

type Props = { color: string; size: number }

// Typed interpolation param: the `Props` type reference must not be mistaken
// for a value reference (it has no value binding under syntax-only TS parsing).
const Typed = styled.p`
  color: ${(props: Props) => props.color};
`

// Generic tag type argument (styled.p<Props>) — type args live on the tagged
// template, not the tag, so the component is still eligible.
const Generic = styled.p<Props>`
  color: ${(props: Props) => props.color};
`

// Destructured typed param reads only its own binding -> still eligible.
const Destructured = styled.p<Props>`
  color: ${({ color }: Props) => color};
`

// Theme access is still ineligible even when the param is typed.
const Themed = styled.p`
  color: ${(props: { theme: { fg: string } }) => props.theme.fg};
`
