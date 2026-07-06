import styled from 'styled-components'

const Parent = styled.div`
  ${props => props.selector} {
    color: red;
  }
`
