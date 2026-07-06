import styled from 'styled-components'

function Wrapper({ children, className }) {
  return <div id="last-native-element" className={className}>{children}</div>
}

const StyledWrapper = styled(Wrapper)`
  background-color: ${props => props.color};
`

const StaticWrapper = styled(Wrapper)`
  color: red;
`
