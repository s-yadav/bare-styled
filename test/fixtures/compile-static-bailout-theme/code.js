import styled from 'styled-components'

const Themed = styled.div`
  color: ${props => props.theme.main};
`

const DestructuredTheme = styled.div`
  background: ${({ theme }) => theme.bg};
`
