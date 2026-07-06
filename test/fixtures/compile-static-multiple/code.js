import styled from 'styled-components'

const First = styled.h1`
  font-weight: 700;
`

const Second = styled.h2`
  font-weight: ${props => props.weight};
`

const Bail = styled.h3`
  color: ${props => props.theme.accent};
`

const Third = styled.h4`
  margin: 0;
`
