import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose'
import { HydratedDocument } from 'mongoose'

@Schema()
export class RegisteredEvent {
  @Prop({ type: String, required: true, default: 'Registered' })
  eventName: 'Registered'

  @Prop({ type: Number, required: true })
  blockNumber: number

  @Prop({ type: String, required: true })
  blockHash: string

  @Prop({ type: String, required: true })
  transactionHash: string

  @Prop({ type: String, required: true })
  address: string

  @Prop({ type: String, required: true })
  fingerprint: string

  @Prop({ type: Boolean, required: true, default: false })
  fulfilled: boolean
}

export type RegisteredEventDocument = HydratedDocument<RegisteredEvent>

export const RegisteredEventSchema = SchemaFactory.createForClass(
  RegisteredEvent
).index({ transactionHash: 1, address: 1, fingerprint: 1 }, { unique: true })
