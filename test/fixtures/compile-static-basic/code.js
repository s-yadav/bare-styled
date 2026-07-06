import styled from 'styled-components'

const Button = styled.button`
  color: blue;
  font-size: 14px;
  border-radius: 4px;

  &:hover {
    color: navy;
  }

  @media (min-width: 600px) {
    padding: 0 16px;
  }
`

const Label = styled('span')`
  display: inline-block;
  user-select: none;
`
