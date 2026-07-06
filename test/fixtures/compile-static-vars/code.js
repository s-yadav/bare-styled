import styled from 'styled-components'

const Text = styled.p`
  color: ${props => props.color};
  font-size: ${({ size }) => size};
`

const UnitSuffix = styled.p`
  font-size: ${({ size }) => size}px;
`
