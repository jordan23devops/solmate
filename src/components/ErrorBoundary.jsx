import { Component } from 'react'

export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props)
    this.state = { error: null }
  }

  static getDerivedStateFromError(error) {
    return { error }
  }

  componentDidCatch(error, info) {
    console.error('[SunSpot] Runtime error:', error)
    console.error('[SunSpot] Component stack:', info.componentStack)
  }

  render() {
    if (this.state.error) {
      return (
        <div className="error-boundary" role="alert">
          <h1>SunSpot crashed</h1>
          <p>{this.state.error.message}</p>
          <pre>{this.state.error.stack}</pre>
          <button type="button" onClick={() => this.setState({ error: null })}>
            Try again
          </button>
        </div>
      )
    }

    return this.props.children
  }
}
